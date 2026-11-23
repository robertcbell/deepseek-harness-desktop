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
mutant M1-no-lock claim-x2 "sub('''   try { fd = fs.openSync(lockPath, 'wx', 0o600); }''', '''   return true;
   try { fd = fs.openSync(lockPath, 'wx', 0o600); }''')"

# M2: lock kept, Ready/unclaimed check removed: a later claimer overwrites the owner.
mutant M2-no-status-check claim-x2 "sub('''  if (r.fields.Status !== 'Ready' || r.fields['Claimed By']) return''', '''  if (false) return''')"

# M3: lock released right after the Ready check, before the owner PATCH.
mutant M3-early-release claim-x2 "sub('''  const r = await get();
''', '''  const r = await get();
  lock.release();
''')"

# M4: lock kept, readback removed. EQUIVALENT for this rule within these
# bounds: under the lock no other claimer can write between PATCH and
# readback. The readback only guards writers outside the lock (another host,
# a human edit), which this check does not model. Expected to survive.
mutant M4-no-readback claim-x2-faults "sub('''  if ((await get()).fields['Claimed By'] !== owner) throw Error('Claim readback mismatch');
''', '')" survives

echo "### baseline (unmutated scripts/gate8/claim.mjs)"
node "$here/explore.mjs" --lib "$root/scripts/gate8"; rc=$?
if [ $rc -eq 0 ]; then echo "### baseline: GREEN"; else echo "### baseline: RED (rc=$rc)"; status=1; fi
exit $status
