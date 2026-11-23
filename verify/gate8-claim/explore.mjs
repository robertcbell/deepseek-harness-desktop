#!/usr/bin/env node
/**
 * Exhaustive interleaving exploration of the REAL scripts/gate8/claim.mjs
 * (claimItem + fileClaimLock), by re-execution. NOT a TLC model check.
 *
 * Rule: one Queue item has at most one owner: at most one claimer receives
 * action:"claimed", and once it has, the record keeps that owner.
 *
 * Every Queue request (GET / PATCH) is a deferred step the explorer releases
 * in a chosen order; a PATCH step may also be released as "applied, response
 * lost" or "not applied, request failed" in fault scenarios. The lock is the
 * real O_EXCL file lock in a fresh temp directory per schedule. Between
 * choices all microtasks drain, so one choice = one atomic step of the real
 * code between two awaits. DFS enumerates every choice sequence; the shortest
 * violating sequence is printed as numbered steps.
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
const { claimItem, fileClaimLock } = await import(pathToFileURL(path.join(libDir, 'claim.mjs')).href);

const SCENARIOS = {
	// Two scheduled sessions claim the same Ready item.
	'claim-x2': { actors: 2, faults: false, saveFails: [] },
	// Same, every PATCH may also be lost-after-apply or fail-before-apply.
	'claim-x2-faults': { actors: 2, faults: true, saveFails: [] },
	// First claimer's local state save throws after both PATCHes landed.
	'claim-x2-savefail': { actors: 2, faults: false, saveFails: [1] },
	'claim-x3': { actors: 3, faults: false, saveFails: [] },
};

const drain = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gate8-claim-explore-'));
process.on('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let runNo = 0;

async function execute(sc, prefix) {
	const lockDir = path.join(tmpRoot, String(runNo++)); fs.mkdirSync(lockDir);
	const real = fileClaimLock(path.join(lockDir, 'gate8-claim.lock'));
	const acquired = new Map(); // owner -> what the real acquire() returned (observation only)
	const lock = { ...real, acquire: o => { const v = real.acquire(o); acquired.set(o, v); return v; } };
	const record = { fields: { Status: 'Ready', 'Claimed By': '' } };
	const ops = []; const log = []; const choices = [];
	const winners = []; let violationAt = -1;
	const ev = { claimed: 0, skipLock: 0, skipStatus: 0, lostResponse: 0, failedPatch: 0, threw: 0 };
	const show = () => `{Status:${record.fields.Status}, Claimed By:${record.fields['Claimed By'] || '(none)'}}`;
	const check = () => {
		if (violationAt >= 0) return;
		const bad = winners.length > 1 || winners.some(w => record.fields['Claimed By'] !== w);
		if (bad) violationAt = log.length;
	};
	const store = who => ({
		get: () => new Promise(resolve => ops.push({ label: `${who} GET -> `, fire: () => { const v = structuredClone(record); resolve(v); return show(); } })),
		patch: fields => new Promise((resolve, reject) => {
			const shown = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'Claimed At'));
			const apply = () => Object.assign(record.fields, fields);
			ops.push({ label: `${who} PATCH ${JSON.stringify(shown)} -> `, fire: () => { apply(); resolve(structuredClone(record)); return show(); } });
			if (sc.faults) {
				ops.push({ group: ops.at(-1), label: `${who} PATCH ${JSON.stringify(shown)} applied, response LOST -> `, fire: () => { apply(); ev.lostResponse++; reject(Error('response lost')); return show(); } });
				ops.push({ group: ops.at(-2), label: `${who} PATCH ${JSON.stringify(shown)} FAILED, not applied -> `, fire: () => { ev.failedPatch++; reject(Error('request failed')); return show(); } });
				ops.at(-3).group = ops.at(-3);
			}
		}),
	});
	for (let i = 1; i <= sc.actors; i++) {
		const who = `claimer${i}`, owner = `harness:cron-gate8-synthetic-po-${i}`;
		ops.push({ label: `${who} starts gate8_claim (owner ${owner}) -> `, fire: () => {
			const s = store(who);
			claimItem({ owner, get: s.get, patch: s.patch, lock, save: () => { if (sc.saveFails.includes(i)) throw Error('state save failed'); } })
				.then(out => {
					if (out.action === 'claimed') { ev.claimed++; winners.push(owner); log.push(`${who} returns action:"claimed"`); check(); }
					else { if (out.reason === 'claim-lock-held') ev.skipLock++; else ev.skipStatus++; log.push(`${who} returns skip (${out.reason ?? 'status ' + out.status + ', claimed=' + out.claimed})`); }
				}, e => { ev.threw++; log.push(`${who} throws: ${e.message}`); });
			return `lock.acquire() returned ${acquired.get(owner)}`;
		} });
	}
	let step = 0;
	for (;;) {
		await drain();
		if (ops.length === 0) break;
		const chosen = step < prefix.length ? prefix[step] : 0;
		choices.push({ chosen, enabled: ops.length });
		const op = ops[chosen];
		// Remove the chosen op and its fault siblings.
		for (let j = ops.length - 1; j >= 0; j--) if (ops[j] === op || (op.group && ops[j].group === op.group)) ops.splice(j, 1);
		log.push(op.label + op.fire());
		check();
		if (++step > 200) throw Error('step bound exceeded');
	}
	await drain();
	return { choices, log, violationAt, ev };
}

async function explore(sc) {
	let prefix = [], schedules = 0, shortest = null, maxDepth = 0;
	const reached = { claimed: 0, skipLock: 0, skipStatus: 0, lostResponse: 0, failedPatch: 0, threw: 0 };
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
	const want = { claimed: true, skipLock: true, skipStatus: true, lostResponse: sc.faults, failedPatch: sc.faults, threw: sc.faults || sc.saveFails.length > 0 };
	const vacuous = Object.entries(want).filter(([k, w]) => w && res.reached[k] === 0).map(([k]) => k);
	const bad = res.shortest !== null || res.truncated || vacuous.length > 0;
	failed ||= bad;
	console.log(`\n== scenario ${name} (${sc.actors} claimers${sc.faults ? ', PATCH faults' : ''}${sc.saveFails.length ? ', save fails for claimer ' + sc.saveFails : ''})`);
	console.log(`   schedules explored: ${res.schedules}${res.truncated ? ' (TRUNCATED at bound)' : ' (exhaustive)'}; max steps per schedule: ${res.maxDepth}`);
	console.log(`   witnesses (schedules reaching each event): ${JSON.stringify(res.reached)}`);
	if (vacuous.length) console.log(`   VACUITY: expected events never reached: ${vacuous.join(', ')}`);
	if (res.shortest) { console.log(`   VIOLATION of one-owner; shortest counterexample (${res.shortest.length} steps):`); res.shortest.forEach((s, i) => console.log(`     ${i + 1}. ${s}`)); }
	else console.log('   one-owner held in every schedule');
}
console.log(`\nlib: ${libDir}\nresult: ${failed ? 'FAIL' : 'PASS'} (${Date.now() - t0} ms)`);
process.exit(failed ? 1 : 0);
