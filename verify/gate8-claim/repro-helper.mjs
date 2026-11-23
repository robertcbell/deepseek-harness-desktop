#!/usr/bin/env node
/**
 * Reproduction of the Gate 8 two-owner claim against the REAL local helper
 * (`gate8-queue.mjs claim <owner>`), run as two independent OS processes
 * against a local fake Airtable HTTP server. Never contacts Airtable.
 *
 *   node verify/gate8-claim/repro-helper.mjs --helper <dir containing gate8-queue.mjs> [--adopt]
 *
 * The helper and its two local imports are copied into a temp directory.
 * Only these constants are rewritten (each must match exactly once): the
 * private credential file, the proof root, the Airtable base URL and the Jev
 * claim-writer import. The claim branch itself runs byte-for-byte. After
 * rewriting, the copy is checked to contain no Airtable host, no ~/.dsh/private
 * path and no live Jev writer.
 *
 * The fake server releases requests in one scripted order (the interleaving
 * from invariant-targets-20261122 rank 5). Exit 0 = both processes printed
 * action:"claimed" (two owners reproduced); 1 = not reproduced; 2 = error.
 *
 * --adopt replaces lines 35-38 of the claim branch (GET check, owner PATCH,
 * readback, Doing PATCH, save) with the lane fix: claimItem() from
 * scripts/gate8/claim.mjs under fileClaimLock(root+'/gate8-claim.lock'). The
 * server then answers in arrival order (the scripted order cannot happen
 * once B is refused by the lock). It also adds the operator command
 * `clear-ambiguous <item> [--force-accept-risk]` (clearAmbiguousLock under the same lock path) as
 * a new branch, and runs it once after both claims: with no lock left it must
 * answer "no-lock". Exit 0 = exactly one process claimed, the other skipped
 * and clear-ambiguous answered; 1 otherwise.
 * Not part of run.sh: the helper is untracked local history (gitignored).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

const argv = process.argv.slice(2);
const helperDir = path.resolve(argv[argv.indexOf('--helper') + 1] ?? '');
if (!argv.includes('--helper') || !fs.existsSync(path.join(helperDir, 'gate8-queue.mjs'))) { console.error('usage: --helper <dir with gate8-queue.mjs>'); process.exit(2); }

const adopt = argv.includes('--adopt');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate8-claim-repro-'));
const root = path.join(tmp, 'proofs'); fs.mkdirSync(root);
const code = path.join(tmp, 'code'); fs.mkdirSync(code);
for (const f of ['gate8-queue.mjs', 'gate8-recovery-core.mjs', 'gate8-airtable-api.mjs']) fs.copyFileSync(path.join(helperDir, f), path.join(code, f));
let src = fs.readFileSync(path.join(code, 'gate8-queue.mjs'), 'utf8');
const original = src;
const sub = (from, to) => { const n = src.split(from).length - 1; if (n !== 1) { console.error(`rewrite anchor found ${n} times: ${from}`); process.exit(2); } src = src.replace(from, to); };
sub(`const root='/Users/agentwork/work/reports/workflow-proofs';`, `const root=${JSON.stringify(root)};`);
sub(`'/Users/agentwork/.dsh/private/airtable.yaml'`, JSON.stringify(path.join(tmp, 'fake-airtable.yaml')));
sub(`const base='https://api.airtable.com/v0/appVE5OCebQjUujgU/tbl5w7B0PvdgkW2xB';`, `const base=process.env.FAKE_BASE;`);
sub(`'/Users/agentwork/Work/Repos/DeepSeekHarness/jev-gates/adapters/dsh/claim.mjs'`, JSON.stringify(path.join(code, 'stub-claim.mjs')));
// The other branches still name ~/.dsh/skills verifiers; claim never runs them.
if (/airtable\.com|\.dsh\/private|jev-gates/.test(src)) { console.error('rewritten helper still references Airtable, private credentials or the live Jev writer; refusing to run'); process.exit(2); }
// The claim branch (from `else if(cmd==='claim'){` to the next branch) must be
// unchanged apart from the stubbed Jev writer import.
const branch = s => s.slice(s.indexOf(`else if(cmd==='claim'){`), s.indexOf(`}else if(cmd==='checkpoint'){`));
const expected = branch(original).replace(`'/Users/agentwork/Work/Repos/DeepSeekHarness/jev-gates/adapters/dsh/claim.mjs'`, JSON.stringify(path.join(code, 'stub-claim.mjs')));
if (branch(src) !== expected || branch(src).length < 100) { console.error('claim branch changed by rewrite'); process.exit(2); }
if (adopt) {
	const claimUrl = new URL('../../scripts/gate8/claim.mjs', import.meta.url).href;
	sub(`  const r=await get();if(r.fields.Status!=='Ready'||r.fields['Claimed By']){console.log(JSON.stringify({action:'skip',status:r.fields.Status,claimed:!!r.fields['Claimed By']}));process.exit(0);}
  await patch({'Claimed By':owner,'Claimed At':new Date().toISOString()});
  if((await get()).fields['Claimed By']!==owner)throw Error('Claim readback mismatch');
  await patch({Status:'Doing'});s.owner=owner;save(s);`, `  const {claimItem,fileClaimLock}=await import(${JSON.stringify(claimUrl)});
  const out=await claimItem({owner,get,patch,item:s.recordId,lock:fileClaimLock(root+'/gate8-claim.lock'),save:o=>{s.owner=o;save(s);}});
  if(out.action!=='claimed'){console.log(JSON.stringify(out));process.exit(0);}`);
	sub(`}else if(cmd==='checkpoint'){`, `}else if(cmd==='clear-ambiguous'){
  if(process.argv[3]!==s.recordId||(process.argv[4]&&process.argv[4]!=='--force-accept-risk'))throw Error('usage: clear-ambiguous <item record id> [--force-accept-risk]');
  const {clearAmbiguousLock,fileClaimLock}=await import(${JSON.stringify(claimUrl)});
  const out=await clearAmbiguousLock({lock:fileClaimLock(root+'/gate8-claim.lock'),item:s.recordId,get,forceAcceptRisk:process.argv[4]==='--force-accept-risk'});
  console.log(JSON.stringify(out));if(out.action==='refused')process.exitCode=3;
 }else if(cmd==='checkpoint'){`);
}
fs.writeFileSync(path.join(code, 'gate8-queue.mjs'), src);
fs.writeFileSync(path.join(code, 'stub-claim.mjs'), 'export function writeClaim(){}\n');
fs.writeFileSync(path.join(tmp, 'fake-airtable.yaml'), 'AIRTABLE_TOKEN: local-fake-not-a-token\n');
fs.writeFileSync(path.join(root, 'gate8-writes-enabled'), '');
const {fixture} = await import(path.join(code, 'gate8-recovery-core.mjs'));
fs.writeFileSync(path.join(root, 'gate8-state.json'), JSON.stringify({recordId: fixture.recordId, key: fixture.key, attempt: 1, repo: '/fake', report: root + '/report.md', mode: 'clean', events: []}));

// Fake Queue record and scripted request order. Each process has its own URL
// prefix (/A, /B) so the server knows who is asking.
const record = {id: fixture.recordId, fields: {Status: 'Ready', 'Claimed By': '', UUID: fixture.key}};
const script = [['A', 'GET'], ['B', 'GET'], ['A', 'PATCH'], ['A', 'GET'], ['B', 'PATCH'], ['B', 'GET'], ['A', 'PATCH'], ['B', 'PATCH']];
const held = []; const log = []; let next = 0;
const pump = () => {
	for (;;) {
		if (next >= script.length) return;
		const [who, method] = script[next];
		const i = held.findIndex(h => h.who === who && h.method === method);
		if (i < 0) return;
		const [h] = held.splice(i, 1); next++;
		if (method === 'PATCH') Object.assign(record.fields, h.body.fields);
		log.push(`${next}. process ${who} ${method}${method === 'PATCH' ? ' ' + JSON.stringify(Object.keys(h.body.fields).reduce((o, k) => k === 'Claimed At' ? o : {...o, [k]: h.body.fields[k]}, {})) : ''} -> record {Status:${record.fields.Status}, Claimed By:${record.fields['Claimed By'] || '(none)'}}`);
		h.res.setHeader('Content-Type', 'application/json'); h.res.end(JSON.stringify(record));
	}
};
const server = http.createServer((req, res) => {
	let data = ''; req.on('data', c => data += c); req.on('end', () => {
		const who = req.url.split('/')[1];
		held.push({who, method: req.method, body: data ? JSON.parse(data) : null, res});
		if (adopt) { const [h] = held.splice(0, 1); script.splice(next, 0, [h.who, h.method]); held.push(h); }
		pump();
	});
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const run = (who, owner) => new Promise(resolve => {
	const p = spawn(process.execPath, [path.join(code, 'gate8-queue.mjs'), 'claim', owner], {env: {...process.env, FAKE_BASE: `http://127.0.0.1:${port}/${who}`}, stdio: ['ignore', 'pipe', 'pipe']});
	let out = '', err = ''; p.stdout.on('data', c => out += c); p.stderr.on('data', c => err += c);
	const t = setTimeout(() => p.kill('SIGKILL'), 20000);
	p.on('close', rc => { clearTimeout(t); resolve({who, owner, rc, out: out.trim(), err: err.trim()}); });
});
const [a, b] = await Promise.all([run('A', 'harness:cron-gate8-synthetic-po-repro-a'), run('B', 'harness:cron-gate8-synthetic-po-repro-b')]);
server.close();
const state = JSON.parse(fs.readFileSync(path.join(root, 'gate8-state.json')));
console.log('helper copy:', path.join(code, 'gate8-queue.mjs'));
console.log('fake-store request order:'); log.forEach(l => console.log('  ' + l));
for (const p of [a, b]) console.log(`process ${p.who} (${p.owner}) rc=${p.rc} stdout=${p.out}${p.err ? ' stderr=' + p.err.split('\n')[0] : ''}`);
console.log(`final record: Status=${record.fields.Status} Claimed By=${record.fields['Claimed By']}; local state owner=${state.owner}`);
const claimedN = [a, b].filter(p => p.rc === 0 && /"action":"claimed"/.test(p.out)).length;
let clear = null;
if (adopt) {
	const srv = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(record)); });
	await new Promise(r => srv.listen(0, '127.0.0.1', r));
	clear = await new Promise(resolve => { const p = spawn(process.execPath, [path.join(code, 'gate8-queue.mjs'), 'clear-ambiguous', fixture.recordId], {env: {...process.env, FAKE_BASE: `http://127.0.0.1:${srv.address().port}/op`}, stdio: ['ignore', 'pipe', 'pipe']});
		let out = ''; p.stdout.on('data', c => out += c); p.on('close', rc => resolve({rc, out: out.trim()})); });
	srv.close();
	console.log(`clear-ambiguous ${fixture.recordId}: rc=${clear.rc} ${clear.out}`);
}
fs.rmSync(tmp, {recursive: true, force: true});
if (adopt) {
	const ok = clear.rc === 0 && /"action":"no-lock"/.test(clear.out) && claimedN === 1 && [a, b].some(p => p.rc === 0 && /"action":"skip"/.test(p.out)) && state.owner === record.fields['Claimed By'];
	console.log(ok ? 'FIX HOLDS: exactly one process claimed; the other skipped; record owner = local owner' : 'FIX FAILED');
	process.exit(ok ? 0 : 1);
}
console.log(claimedN === 2 ? 'REPRODUCED: both processes returned action:"claimed" for one Queue item (two owners)' : 'NOT REPRODUCED');
process.exit(claimedN === 2 ? 0 : 1);
