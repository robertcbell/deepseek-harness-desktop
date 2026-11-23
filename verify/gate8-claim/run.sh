#!/usr/bin/env bash
# One-command rerun of the Gate 8 one-owner claim verification.
#   bash verify/gate8-claim/run.sh          # explorer + tests + mutations + TLC
#   bash verify/gate8-claim/run.sh --quick  # skip mutations
# Exit 0 only when: the explorer is GREEN with all witnesses, the claim tests
# pass, (unless --quick) every non-equivalent mutant is KILLED, and, if
# tla2tools.jar ($TLA2TOOLS or verify/gate8-claim/.tools/tla2tools.jar)
# exists, every TLC config meets its declared expectation. Without the jar TLC
# is reported SKIPPED (never PASS); REQUIRE_TLC=1 makes that a failure.
# TLC writes only to a temp -metadir with -noGenerateSpecTE: nothing in verify/.
# Every subprocess exit status is checked; no checked output goes through a pipe.
set -u -o pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$root" || exit 2
echo "node $(node -v); HEAD $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

echo "== covered-file drift (vs SKILL.md last-checked hashes)"
skill="$root/.agents/skills/verify-gate8-claim/SKILL.md"
drift=0
while read -r want file; do
	have="$(shasum -a 256 "$file" | cut -d' ' -f1)"
	if [ "$have" = "$want" ]; then echo "  same   $file"; else echo "  DRIFT  $file (remap actions + rerun mutations before trusting a pass)"; drift=1; fi
done < <(sed -n 's/^- sha256 \([0-9a-f]\{64\}\) `\(.*\)`$/\1 \2/p' "$skill")

echo "== real-code interleaving explorer (NOT a TLC model check)"
node "$here/explore.mjs"; rc=$?
[ $rc -eq 0 ] || { echo "explorer FAILED (rc=$rc)"; exit 1; }

echo "== claim tests (real processes, fake Queue)"
node --test "$root/tests/gate8/claim.test.mjs"; rc=$?
[ $rc -eq 0 ] || { echo "claim tests FAILED (rc=$rc)"; exit 1; }

if [ "${1:-}" != "--quick" ]; then
	echo "== mutation check"
	bash "$here/mutate.sh" || { echo "mutation check FAILED"; exit 1; }
fi

# ---- TLC: every configuration has an explicit expected outcome ----------
#   Gate8Claim*.cfg  correct model        -> must PASS (no error found)
#   Mutant-*.cfg     guard removed        -> its single INVARIANT (OneOwner, or
#                                            LockHygiene for M7) must be VIOLATED
#   Witness-*.cfg    non-vacuity witness  -> its own INVARIANT must be VIOLATED
# A config "fails as expected" only if TLC names the expected invariant; an
# unrelated crash is an ERROR, never a pass.
tlc_status=SKIPPED
jar="${TLA2TOOLS:-$here/.tools/tla2tools.jar}"
if [ ! -f "$jar" ]; then
	echo "== TLC SKIPPED: tla2tools.jar not found ($jar); Gate8Claim.tla is UNCHECKED by TLC"
elif ! java -version >/dev/null 2>&1; then
	echo "== TLC ERROR: tla2tools.jar present but no working Java runtime"
	exit 1
else
	echo "== TLC ($jar)"
	tlc_fail=0
	tlc_out="$(mktemp "${TMPDIR:-/tmp}/gate8-claim-tlc.XXXXXX")"
	tlc_meta="$(mktemp -d "${TMPDIR:-/tmp}/gate8-claim-meta.XXXXXX")"
	trap 'rm -rf "${tlc_meta:?}" "${tlc_out:?}"' EXIT
	for cfg in "$here"/*.cfg; do
		name="$(basename "$cfg" .cfg)"
		case "$name" in
			Gate8Claim*) expect=pass; inv="" ;;
			Mutant-*|Witness-*) expect=violate; inv="$(sed -n 's/^INVARIANTS TypeOK \([A-Za-z]*\)$/\1/p' "$cfg")" ;;
			*) echo "-- $name: no expectation declared -> ERROR"; tlc_fail=1; continue ;;
		esac
		(cd "$here" && java -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers auto -metadir "$tlc_meta/$name" -noGenerateSpecTE -config "$name.cfg" Gate8Claim.tla) >"$tlc_out" 2>&1
		rc=$?
		grep -E "states generated|distinct states|[Ww]arning" "$tlc_out" | sed 's/^/     /'
		if [ "$expect" = pass ]; then
			if [ $rc -eq 0 ] && grep -q "No error has been found" "$tlc_out"; then verdict="ok (passed, as expected)"
			else verdict="FAIL (expected pass; java rc=$rc)"; tlc_fail=1; tail -30 "$tlc_out"; fi
		else
			if [ $rc -ne 0 ] && [ -n "$inv" ] && grep -q "Invariant $inv is violated" "$tlc_out"; then verdict="ok ($inv violated, as expected)"
				case "$name" in Mutant-NoLock|Mutant-ReleaseOnAmbiguous) true ;; *) false ;; esac && { echo "     shortest TLC trace (BFS):"; grep -E "^State [0-9]+:|^/\\\\ (pc|owner|claimed|status|lock|pendOwner) " "$tlc_out" | sed 's/^/       /'; }
			else verdict="FAIL (expected 'Invariant $inv is violated'; java rc=$rc)"; tlc_fail=1; tail -30 "$tlc_out"; fi
		fi
		echo "-- $name [expect $expect${inv:+ $inv}]: $verdict"
	done
	rm -rf "${tlc_meta:?}" "$tlc_out"
	[ $tlc_fail -eq 0 ] || { echo "TLC check FAILED"; exit 1; }
	tlc_status=PASS
fi
[ $drift -eq 0 ] || echo "NOTE: covered files drifted since last check; update SKILL.md after remapping."
mut_status=PASS; [ "${1:-}" = "--quick" ] && mut_status=SKIPPED
echo "verify gate8-claim: explorer=PASS tests=PASS mutations=$mut_status tlc=$tlc_status"
if [ "${REQUIRE_TLC:-0}" = 1 ] && [ "$tlc_status" != PASS ]; then echo "REQUIRE_TLC=1 but TLC was $tlc_status"; exit 1; fi
exit 0
