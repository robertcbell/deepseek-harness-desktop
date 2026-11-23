#!/usr/bin/env bash
# Mutation check: break each real guard of scripts/gate8/claim.mjs in a temp
# copy, expect the explorer to go RED with a numbered counterexample; then
# confirm the unmutated file is GREEN. Never edits scripts/ itself.
# Usage (repo root): bash verify/gate8-claim/mutate.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gate8-claim-mut.XXXXXX")"
trap 'rm -rf "${tmp:?}"' EXIT
status=0

mutant() { # name, scenario, python body operating on s, [expect=killed|survives]
	local name="$1" scen="$2" body="$3" expect="${4:-killed}" dir="$tmp/$1"
	mkdir -p "$dir" && cp "$root/scripts/gate8/claim.mjs" "$dir/"
	F="$dir/claim.mjs" python3 -c "
import os
f=os.environ['F']; s=open(f).read()
def sub(old, new):
    global s
    assert s.count(old)==1, 'mutation anchor not unique/found: %r (%d)' % (old[:60], s.count(old))
    s=s.replace(old, new)
$body
open(f,'w').write(s)
" || { echo "mutation $name could not be applied"; exit 2; }
	echo "### mutant $name (scenario $scen)"
	node "$here/explore.mjs" --lib "$dir" --scenario "$scen" >"$tmp/$name.out" 2>&1
	local rc=$?
	cat "$tmp/$name.out"
	if [ "$expect" = survives ]; then
		if [ $rc -eq 0 ]; then echo "### mutant $name: SURVIVED as expected (equivalent mutant for this rule)"
		else echo "### mutant $name: unexpectedly RED (rc=$rc) -- re-examine the equivalence claim"; status=1; fi
	elif [ $rc -eq 1 ] && grep -q "VIOLATION" "$tmp/$name.out" && grep -qE '^     1\. ' "$tmp/$name.out"; then
		echo "### mutant $name: KILLED (explorer RED with numbered trace, as expected)"
	else
		echo "### mutant $name: SURVIVED (rc=$rc) -- check is too weak"; status=1
	fi
}

# M1: no lock (= the original helper: GET check, PATCH owner, readback, PATCH Doing).
# The original also had no lock metadata, so mark() becomes a no-op too (with
# mark() active, its lost-lock check alone would stop every claim: ELOCKLOST).
NO_MARK="sub('''  mark(fields) {
''', '''  mark(fields) { return;
''')"
mutant M1-no-lock claim-x2 "sub('''   try { fs.linkSync(tmp, lockPath); return true; }''', '''   try { fs.rmSync(tmp, { force: true }); return true; }''')
$NO_MARK"

# M2: lock kept, Ready/unclaimed check removed: a later claimer overwrites the owner.
mutant M2-no-status-check claim-x2 "sub('''  if (r.fields.Status !== 'Ready' || r.fields['Claimed By']) return''', '''  if (false) return''')"

# M3: lock released right after the Ready check, before the owner PATCH
# (mark() disabled as in M1; otherwise the lost-lock check stops the claim).
mutant M3-early-release claim-x2 "sub('''  const r = await get();
''', '''  const r = await get();
  lock.release();
''')
$NO_MARK"

# M4: lock kept, readback removed. EQUIVALENT for this rule within these
# bounds: under the lock no other claimer can write between PATCH and
# readback. The readback only guards writers outside the lock (another host,
# a human edit), which this check does not model. Expected to survive.
mutant M4-no-readback claim-x2-delayed "sub('''  if ((await get()).fields['Claimed By'] !== owner) throw Error('Claim readback mismatch');
''', '')" survives

# M5: release the lock after ANY PATCH error (= 8b51cb5, review blocker 1):
# a timed-out PATCH lands after the next claimer took the item.
mutant M5-release-on-ambiguous claim-x2-delayed "sub('''   if (definitePatchFailure(e)) throw e;
''', '''   throw e;
''')"

# M6: treat timeouts/network errors as definite (only 5xx stays ambiguous):
# a timeout releases the lock and its PATCH lands later.
mutant M6-timeout-as-definite claim-x2-delayed "sub('''export const definitePatchFailure = e => Number.isInteger(e?.httpStatus) && e.httpStatus >= 400 && e.httpStatus <= 499;''', '''export const definitePatchFailure = e => !(Number.isInteger(e?.httpStatus) && e.httpStatus >= 500);''')"

# M7: keep the lock after every PATCH error, including a definite HTTP 422.
# Safe for one-owner, but it leaves a lock with no ambiguity; the explorer's
# lock check (LEAK) must catch it.
mutant M7-keep-on-definite claim-x2-faults "sub('''   if (definitePatchFailure(e)) throw e;
   keep = true;''', '''   keep = true;''')"

# M8: clear-ambiguous without the quiescence window (= the old advice:
# remove the lock once no claimer is running). A delayed PATCH lands after the
# clear and overwrites the next claimer (the reviewer's loopback reproduction).
mutant M8-clear-no-window claim-x2-clear "sub('''  if (waited < quiescenceMs) return''', '''  if (false) return''')"

# M9: clear-ambiguous without the second (settle) read. EQUIVALENT under the
# explorer's timing assumption (no PATCH is in flight once the window has
# passed), so it is expected to survive. The double read is defence in depth
# for a store that breaks that assumption; tests/gate8/claim.test.mjs covers
# it directly ("a PATCH landing between the two settle reads is detected").
mutant M9-clear-single-read claim-x2-clear "sub('''  const r1 = await get(); await pause(settleMs); const r2 = await get();''', '''  const r2 = await get(); const r1 = r2;''')" survives

echo "### baseline (unmutated scripts/gate8/claim.mjs)"
node "$here/explore.mjs" --lib "$root/scripts/gate8"; rc=$?
if [ $rc -eq 0 ]; then echo "### baseline: GREEN"; else echo "### baseline: RED (rc=$rc)"; status=1; fi
exit $status
