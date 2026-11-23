#!/usr/bin/env node
/**
 * Exhaustive interleaving exploration of the REAL scripts/gate8/claim.mjs
 * (claimItem + fileClaimLock), by re-execution. NOT a TLC model check.
 *
 * Rule: one Queue item has at most one owner: at most one claimer receives
 * action:"claimed", and once it has, the record keeps that owner.
 *
 * Every Queue request (GET / PATCH) is a deferred step the explorer releases
 * in a chosen order. In fault scenarios a PATCH may instead end as:
 *   - applied, response lost (ambiguous error, already applied);
 *   - timed out, applied LATER (ambiguous error now; the delayed commit is a
 *     separate step the explorer may schedule after any later step);
 *   - timed out, never applied (ambiguous error);
 *   - HTTP 422 rejected (definite failure, not applied).
 * Extra check: a lock file is left behind only after an ambiguous PATCH
 * (no leaked lock after a clean or definite outcome). The lock is the
 * real O_EXCL file lock in a fresh temp directory per schedule. Between
 * choices all microtasks drain, so one choice = one atomic step of the real
 * code between two awaits. DFS enumerates every choice sequence; the shortest
 * violating sequence is printed as numbered steps.
 *
 * Scenario claim-x2-clear adds the operator: one run of the REAL
 * clearAmbiguousLock (`gate8-queue.mjs clear-ambiguous`) as a step at any
 * point, its settle pause as a separate step (delayed PATCHes may land
 * between its two reads), and one virtual-clock step that advances time by
 * CLEAR_QUIESCENCE_MS. The clock step is enabled only when no delayed PATCH
 * is still in flight: that is the TIMING ASSUMPTION behind the window (no
 * PATCH is applied later than CLEAR_QUIESCENCE_MS after it started). The
 * explorer cannot check that assumption; it checks that, if it holds, a
 * clear never yields two owners. Mutant M8 (no window) shows what happens
 * without it.
 *
 * Usage: node explore.mjs [--lib <dir with claim.mjs>] [--scenario <name>|all]
 * Exit 0 = rule held in every schedule AND witnesses reached; 1 = violation,
 * vacuity or truncation; 2 = error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const libDir = path.resolve(opt('--lib', path.join(here, '../../scripts/gate8')));
const which = opt('--scenario', 'all');
const MAX = Number(opt('--max-schedules', '200000'));
const { claimItem, fileClaimLock, clearAmbiguousLock, CLEAR_QUIESCENCE_MS } = await import(pathToFileURL(path.join(libDir, 'claim.mjs')).href);

const SCENARIOS = {
	// Two scheduled sessions claim the same Ready item.
	'claim-x2': { actors: 2, faults: false, saveFails: [] },
	// Same, every PATCH may also be lost-after-apply or fail-before-apply.
	'claim-x2-faults': { actors: 2, faults: true, noDelayed: true, saveFails: [] },
	// Every PATCH may also time out and land later (the reviewed blocker).
	'claim-x2-delayed': { actors: 2, faults: true, saveFails: [] },
	// First claimer's local state save throws after both PATCHes landed.
	'claim-x2-savefail': { actors: 2, faults: false, saveFails: [1] },
	'claim-x3': { actors: 3, faults: false, saveFails: [] },
	// Operator clear (real clearAmbiguousLock) + one clock tick past the window.
	// Claimer 2 has no PATCH faults, which bounds the state space.
	'claim-x2-clear': { actors: 2, faults: true, faultsFor: [1], clear: true, saveFails: [] },
};

const drain = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gate8-claim-explore-'));
process.on('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let runNo = 0;

async function execute(sc, prefix) {
	const lockDir = path.join(tmpRoot, String(runNo++)); fs.mkdirSync(lockDir);
	const clock = { t: Date.parse('2026-11-22T10:00:00Z') };
	const real = fileClaimLock(path.join(lockDir, 'gate8-claim.lock'), { now: () => clock.t });
	const acquired = new Map(); // owner -> what the real acquire() returned (observation only)
	const lock = { ...real, acquire: o => { const v = real.acquire(o); acquired.set(o, v); return v; } };
	const record = { fields: { Status: 'Ready', 'Claimed By': '' } };
	const ops = []; const log = []; const choices = [];
	const winners = []; let violationAt = -1;
	const ev = { claimed: 0, skipLock: 0, skipStatus: 0, lostResponse: 0, failedPatch: 0, threw: 0, delayedLanded: 0, needsOperator: 0, keptLock: 0, cleared: 0, clearRefused: 0, claimAfterClear: 0 };
	let clearedOnce = false;
	const delayedPending = () => ops.some(o => o.delayed);
	let ambiguousSeen = false;
	const show = () => `{Status:${record.fields.Status}, Claimed By:${record.fields['Claimed By'] || '(none)'}}`;
	const check = () => {
		if (violationAt >= 0) return;
		const bad = winners.length > 1 || winners.some(w => record.fields['Claimed By'] !== w);
		if (bad) violationAt = log.length;
	};
	const ambiguous = msg => Object.assign(Error(msg), { code: 'ETIMEDOUT' });
	const store = who => ({
		get: () => new Promise(resolve => ops.push({ label: `${who} GET -> `, fire: () => { const v = structuredClone(record); resolve(v); return show(); } })),
		patch: fields => new Promise((resolve, reject) => {
			const shown = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'Claimed At'));
			const apply = () => Object.assign(record.fields, fields);
			const p = `${who} PATCH ${JSON.stringify(shown)}`;
			const group = {};
			const alts = [{ label: `${p} -> `, fire: () => { apply(); resolve(structuredClone(record)); return show(); } }];
			if (sc.faults && (!sc.faultsFor || sc.faultsFor.includes(Number(who.slice(-1))))) {
				alts.push({ label: `${p} applied, response LOST (timeout) -> `, fire: () => { apply(); ev.lostResponse++; ambiguousSeen = true; reject(ambiguous('response lost')); return show(); } });
				alts.push({ label: `${p} REJECTED HTTP 422, not applied -> `, fire: () => { ev.failedPatch++; reject(Object.assign(Error('HTTP 422'), { httpStatus: 422 })); return show(); } });
				alts.push({ label: `${p} TIMED OUT, never applied -> `, fire: () => { ambiguousSeen = true; reject(ambiguous('timeout')); return show(); } });
				if (!sc.noDelayed) alts.push({ label: `${p} TIMED OUT (request still in flight) -> `, fire: () => {
					ambiguousSeen = true; reject(ambiguous('timeout'));
					ops.push({ delayed: true, label: `${who}'s delayed PATCH ${JSON.stringify(shown)} is applied by the store -> `, fire: () => { apply(); ev.delayedLanded++; return show(); } });
					return show();
				} });
			}
			for (const a of alts) ops.push({ ...a, group });
		}),
	});
	for (let i = 1; i <= sc.actors; i++) {
		const who = `claimer${i}`, owner = `harness:cron-gate8-synthetic-po-${i}`;
		ops.push({ label: `${who} starts gate8_claim (owner ${owner}) -> `, fire: () => {
			const s = store(who);
			claimItem({ owner, get: s.get, patch: s.patch, lock, save: () => { if (sc.saveFails.includes(i)) throw Error('state save failed'); } })
				.then(out => {
					if (out.action === 'claimed') { ev.claimed++; if (clearedOnce) ev.claimAfterClear++; winners.push(owner); log.push(`${who} returns action:"claimed"`); check(); }
					else if (out.action === 'needs-operator') { ev.needsOperator++; log.push(`${who} returns needs-operator (lock kept: ${out.reason})`); }
					else { if (out.reason === 'claim-lock-held') ev.skipLock++; else ev.skipStatus++; log.push(`${who} returns skip (${out.reason ?? 'status ' + out.status + ', claimed=' + out.claimed})`); }
				}, e => { ev.threw++; log.push(`${who} throws: ${e.message}`); });
			return `lock.acquire() returned ${acquired.get(owner)}`;
		} });
	}
	if (sc.clear) {
		ops.push({ label: `clock advances CLEAR_QUIESCENCE_MS (${CLEAR_QUIESCENCE_MS / 60000} min; assumption: no PATCH still in flight) -> `,
			enabled: () => !delayedPending(), fire: () => { clock.t += CLEAR_QUIESCENCE_MS; return `now ${new Date(clock.t).toISOString()}`; } });
		ops.push({ label: 'operator runs gate8-queue.mjs clear-ambiguous -> ', fire: () => {
			const s = store('operator');
			const pause = () => new Promise(resolve => ops.push({ label: 'operator settle pause between the two reads ends -> ', fire: () => { resolve(); return show(); } }));
			clearAmbiguousLock({ lock: real, item: undefined, get: s.get, pause, now: () => clock.t })
				.then(out => {
					if (out.action === 'cleared') { ev.cleared++; clearedOnce = true; log.push(`operator clear: cleared (patchLanded=${out.patchLanded})`); }
					else { if (out.action === 'refused') ev.clearRefused++; log.push(`operator clear: ${out.action}${out.reason ? ' (' + out.reason + ')' : ''}`); }
				}, e => { log.push(`operator clear throws: ${e.message}`); });
			return 'started';
		} });
	}
	let step = 0;
	for (;;) {
		await drain();
		if (ops.length === 0) break;
		const en = ops.filter(o => !o.enabled || o.enabled());
		if (en.length === 0) throw Error('no enabled step');
		const chosen = step < prefix.length ? prefix[step] : 0;
		choices.push({ chosen, enabled: en.length });
		const op = en[chosen];
		// Remove the chosen op and its fault siblings.
		for (let j = ops.length - 1; j >= 0; j--) if (ops[j] === op || (op.group && ops[j].group === op.group)) ops.splice(j, 1);
		log.push(op.label + op.fire());
		check();
		if (++step > 200) throw Error('step bound exceeded');
	}
	await drain();
	if (real.holder() !== null) {
		ev.keptLock++;
		// A lock may outlive the run only after an ambiguous PATCH (kept on purpose).
		if (!ambiguousSeen && violationAt < 0) { log.push(`LEAK: lock file left behind without any ambiguous PATCH (holder ${JSON.stringify(real.holder())})`); violationAt = log.length; }
	}
	return { choices, log, violationAt, ev };
}

async function explore(sc) {
	let prefix = [], schedules = 0, shortest = null, maxDepth = 0;
	const reached = { claimed: 0, skipLock: 0, skipStatus: 0, lostResponse: 0, failedPatch: 0, threw: 0, delayedLanded: 0, needsOperator: 0, keptLock: 0, cleared: 0, clearRefused: 0, claimAfterClear: 0 };
	for (;;) {
		const r = await execute(sc, prefix); schedules++;
		maxDepth = Math.max(maxDepth, r.choices.length);
		for (const k of Object.keys(reached)) reached[k] += r.ev[k] > 0 ? 1 : 0;
		if (r.violationAt >= 0) { const t = r.log.slice(0, r.violationAt); if (!shortest || t.length < shortest.length) shortest = t; }
		let i = r.choices.length - 1;
		while (i >= 0 && r.choices[i].chosen + 1 >= r.choices[i].enabled) i--;
		if (i < 0) break;
		prefix = r.choices.slice(0, i).map(c => c.chosen); prefix.push(r.choices[i].chosen + 1);
		if (schedules >= MAX) return { schedules, maxDepth, truncated: true, shortest, reached };
	}
	return { schedules, maxDepth, truncated: false, shortest, reached };
}

const names = which === 'all' ? Object.keys(SCENARIOS) : [which];
let failed = false; const t0 = Date.now();
for (const name of names) {
	const sc = SCENARIOS[name];
	if (!sc) { console.error(`unknown scenario ${name}`); process.exit(2); }
	const res = await explore(sc);
	const want = { claimed: true, skipLock: true, skipStatus: true, lostResponse: sc.faults, failedPatch: sc.faults, threw: sc.faults || sc.saveFails.length > 0,
		delayedLanded: sc.faults && !sc.noDelayed, needsOperator: sc.faults, keptLock: sc.faults, cleared: !!sc.clear, clearRefused: !!sc.clear, claimAfterClear: !!sc.clear };
	const vacuous = Object.entries(want).filter(([k, w]) => w && res.reached[k] === 0).map(([k]) => k);
	const bad = res.shortest !== null || res.truncated || vacuous.length > 0;
	failed ||= bad;
	console.log(`\n== scenario ${name} (${sc.actors} claimers${sc.faults ? (sc.noDelayed ? ', PATCH faults' : ', PATCH faults incl. delayed commit') : ''}${sc.saveFails.length ? ', save fails for claimer ' + sc.saveFails : ''})`);
	console.log(`   schedules explored: ${res.schedules}${res.truncated ? ' (TRUNCATED at bound)' : ' (exhaustive)'}; max steps per schedule: ${res.maxDepth}`);
	console.log(`   witnesses (schedules reaching each event): ${JSON.stringify(res.reached)}`);
	if (vacuous.length) console.log(`   VACUITY: expected events never reached: ${vacuous.join(', ')}`);
	if (res.shortest) { console.log(`   VIOLATION of one-owner; shortest counterexample (${res.shortest.length} steps):`); res.shortest.forEach((s, i) => console.log(`     ${i + 1}. ${s}`)); }
	else console.log('   one-owner held in every schedule');
}
console.log(`\nlib: ${libDir}\nresult: ${failed ? 'FAIL' : 'PASS'} (${Date.now() - t0} ms)`);
process.exit(failed ? 1 : 0);
