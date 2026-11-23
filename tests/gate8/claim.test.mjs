import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {claimItem, fileClaimLock, clearAmbiguousLock, CLEAR_QUIESCENCE_MS} from '../../scripts/gate8/claim.mjs';

const claimUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/gate8/claim.mjs')).href;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate8-claim-test-'));

// Fake Queue: a local HTTP server holding one record (last-writer-wins PATCH,
// like Airtable). With `script` ([[who, method], ...]) it answers requests
// strictly in that order, holding any request that arrives early; this forces
// one interleaving deterministically. Without a script it answers at once.
async function fakeQueue(script) {
 const record = {id: 'fixture', fields: {Status: 'Ready', 'Claimed By': ''}};
 const held = []; let next = 0;
 const answer = h => { if (h.method === 'PATCH') Object.assign(record.fields, JSON.parse(h.body).fields); h.res.setHeader('Content-Type', 'application/json'); h.res.end(JSON.stringify(record)); };
 const pump = () => { while (next < script.length) { const [who, method] = script[next]; const i = held.findIndex(h => h.who === who && h.method === method); if (i < 0) return; next++; answer(held.splice(i, 1)[0]); } };
 const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
   const h = {who: req.url.split('/')[1], method: req.method, body, res};
   if (!script) answer(h); else { held.push(h); pump(); }
  });
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 return {record, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })};
}

// Child claimer: two separate OS processes, each with its own module instance,
// rendezvous on a barrier file so they start the claim together.
const child = `
import fs from 'node:fs';
import {claimItem,fileClaimLock} from ${JSON.stringify(claimUrl)};
const [base,lockPath,barrier,owner,useLock,who]=process.argv.slice(1);
const api=async(method,fields)=>{const r=await fetch(base+'/'+who,{method,headers:{'Content-Type':'application/json'},body:fields?JSON.stringify({fields}):undefined});return r.json();};
const noLock={acquire:()=>true,release(){},holder:()=>null};
fs.writeFileSync(barrier+'.'+owner,'');while(fs.readdirSync(fs.realpathSync(barrier+'/..')).filter(n=>n.startsWith('go.')).length<2){await new Promise(r=>setTimeout(r,1));}
const slow=ms=>new Promise(r=>setTimeout(r,ms));
const out=await claimItem({owner,lock:useLock==='1'?fileClaimLock(lockPath):noLock,get:async()=>{const v=await api('GET');await slow(30);return v;},patch:async f=>{const v=await api('PATCH',f);await slow(30);return v;},save(){}}).catch(e=>({action:'error',message:e.message}));
console.log(JSON.stringify(out));
`;
async function race(useLock, script) {
 const dir = tmp(); const q = await fakeQueue(script);
 try {
  const run = (owner, who) => new Promise(resolve => {
   const p = spawn(process.execPath, ['--input-type=module', '-e', child, q.base, path.join(dir, 'gate8-claim.lock'), path.join(dir, 'go'), owner, useLock ? '1' : '0', who], {stdio: ['ignore', 'pipe', 'inherit']});
   let out = ''; p.stdout.on('data', c => out += c); p.on('close', () => resolve(JSON.parse(out.trim().split('\n').at(-1))));
  });
  const results = await Promise.all([run('harness:cron-gate8-synthetic-po-a', 'A'), run('harness:cron-gate8-synthetic-po-b', 'B')]);
  return {results, record: q.record};
 } finally { await q.close(); fs.rmSync(dir, {recursive: true, force: true}); }
}

test('two concurrent OS-process claimers without the lock both succeed (the bug, on a fake Queue)', async () => {
 // invariant-targets-20261122 rank 5 interleaving.
 const {results} = await race(false, [['A', 'GET'], ['B', 'GET'], ['A', 'PATCH'], ['A', 'GET'], ['B', 'PATCH'], ['B', 'GET'], ['A', 'PATCH'], ['B', 'PATCH']]);
 assert.equal(results.filter(r => r.action === 'claimed').length, 2, JSON.stringify(results));
});

test('with the lock, two concurrent OS-process claimers yield exactly one owner and the record keeps it', async () => {
 for (let round = 0; round < 5; round++) {
  const {results, record} = await race(true);
  const winners = results.filter(r => r.action === 'claimed');
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(record.fields['Claimed By'], winners[0].owner);
  assert.equal(record.fields.Status, 'Doing');
 }
});

test('a single claim succeeds and releases the lock; a held lock makes claim skip without touching the Queue', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'l');
 try {
  const fields = {Status: 'Ready', 'Claimed By': ''}; let saved = null;
  const out = await claimItem({owner: 'o1', lock: fileClaimLock(lockPath), get: async () => ({fields: {...fields}}), patch: async f => Object.assign(fields, f), save: o => { saved = o; }});
  assert.deepEqual(out, {action: 'claimed', owner: 'o1'}); assert.equal(saved, 'o1'); assert.equal(fs.existsSync(lockPath), false);
  const other = fileClaimLock(lockPath); assert.equal(other.acquire('stale'), true);
  const skip = await claimItem({owner: 'o2', lock: fileClaimLock(lockPath), get: async () => assert.fail('no Queue read'), patch: async () => assert.fail('no Queue write'), save: () => assert.fail('no save')});
  assert.equal(skip.action, 'skip'); assert.equal(skip.reason, 'claim-lock-held'); assert.equal(skip.holder.owner, 'stale');
  assert.equal(fs.existsSync(lockPath), true, 'a foreign lock is never removed by a skipping claimer');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

const ready = () => ({fields: {Status: 'Ready', 'Claimed By': ''}});
// What fetch with AbortSignal.timeout throws in scripts/gate8/airtable-api.mjs.
const timeoutError = () => new DOMException('deadline', 'TimeoutError');

test('review blocker 1: a timed-out PATCH that lands later cannot give a second claimer ownership', async () => {
 // Shared last-writer-wins record. A's owner PATCH times out but is applied
 // after B's claim would otherwise have completed.
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 try {
  const record = ready(); let delayed = null;
  const get = async () => structuredClone(record);
  const patchFor = who => async fields => {
   if (who === 'A' && fields['Claimed By']) { delayed = () => Object.assign(record.fields, fields); throw timeoutError(); }
   Object.assign(record.fields, fields); return structuredClone(record);
  };
  const a = await claimItem({owner: 'A', lock: fileClaimLock(lockPath), get, patch: patchFor('A'), save: () => assert.fail('A must not save')});
  assert.equal(a.action, 'needs-operator'); assert.equal(a.lockPath, lockPath); assert.match(a.message, new RegExp(lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.existsSync(lockPath), true, 'ambiguous PATCH keeps the lock');
  assert.equal(fileClaimLock(lockPath).holder().state, 'ambiguous');
  const b = await claimItem({owner: 'B', lock: fileClaimLock(lockPath), get, patch: patchFor('B'), save: () => assert.fail('B must not save')});
  assert.equal(b.action, 'skip'); assert.equal(b.reason, 'claim-lock-held'); assert.equal(b.lockPath, lockPath);
  assert.match(b.message, /ambiguous/); assert.match(b.message, /clear-ambiguous/); assert.doesNotMatch(b.message, /\bremove\b|\brm\b/, 'skip message must not advise deleting the lock');
  delayed();
  assert.equal(record.fields['Claimed By'], 'A'); assert.equal(record.fields.Status, 'Ready');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('network errors and HTTP 5xx are ambiguous (lock kept); only HTTP 4xx releases', async () => {
 const dir = tmp();
 try {
  const cases = [[timeoutError(), 'needs-operator', true], [Object.assign(Error('fetch failed'), {cause: {code: 'ECONNRESET'}}), 'needs-operator', true],
   [Object.assign(Error('Airtable PATCH: HTTP 503'), {httpStatus: 503}), 'needs-operator', true], [Object.assign(Error('Airtable PATCH: HTTP 422'), {httpStatus: 422}), 'throws', false]];
  for (const [n, [err, want, kept]] of cases.entries()) for (const step of ['owner', 'doing']) {
   const lockPath = path.join(dir, `l-${n}-${step}`);
   const run = claimItem({owner: 'o', lock: fileClaimLock(lockPath), get: (() => { let n = 0; return async () => ({fields: {Status: 'Ready', 'Claimed By': n++ ? 'o' : ''}}); })(),
    patch: (() => { let k = 0; return async () => { k++; if ((step === 'owner' && k === 1) || (step === 'doing' && k === 2)) throw err; return {}; }; })(), save: () => assert.fail('no save')});
   if (want === 'throws') await assert.rejects(run, /HTTP 422/);
   else assert.equal((await run).action, want);
   assert.equal(fs.existsSync(lockPath), kept, `${err.message} at ${step}`);
  }
  // Readback mismatch after a confirmed PATCH answer: release is allowed.
  const lockPath = path.join(dir, 'l-readback');
  await assert.rejects(claimItem({owner: 'o1', lock: fileClaimLock(lockPath), get: (() => { let n = 0; return async () => ({fields: {Status: 'Ready', 'Claimed By': n++ ? 'someone-else' : ''}}); })(), patch: async () => ({}), save: () => assert.fail('no save')}), /readback mismatch/);
  assert.equal(fs.existsSync(lockPath), false);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('review blocker 2: ENOSPC while writing lock metadata leaves no lock and no temp file', async () => {
 // Inject through the real node:fs module (both write paths), so the test
 // does not depend on how claim.mjs writes the metadata.
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 const enospc = () => Object.assign(Error('ENOSPC: no space left on device, write'), {code: 'ENOSPC'});
 const real = {writeSync: fs.writeSync, writeFileSync: fs.writeFileSync};
 try {
  fs.writeSync = () => { throw enospc(); };
  fs.writeFileSync = (file, data, opts) => { real.writeFileSync(file, String(data).slice(0, 3), opts); throw enospc(); };
  let rejected;
  try { await claimItem({owner: 'o1', lock: fileClaimLock(lockPath), get: async () => assert.fail('no Queue read'), patch: async () => assert.fail('no Queue write'), save: () => assert.fail('no save')}); }
  catch (e) { rejected = e; }
  Object.assign(fs, real);
  assert.equal(rejected?.code, 'ENOSPC');
  assert.deepEqual(fs.readdirSync(dir), [], 'no lock and no temp file left behind');
  // The next claimer is not blocked.
  const record = ready();
  const out = await claimItem({owner: 'o2', lock: fileClaimLock(lockPath), get: async () => structuredClone(record), patch: async f => Object.assign(record.fields, f), save() {}});
  assert.equal(out.action, 'claimed'); assert.deepEqual(fs.readdirSync(dir), []);
 } finally { Object.assign(fs, real); fs.rmSync(dir, {recursive: true, force: true}); }
});

// ---- clear-ambiguous: the only supported way to clear an ambiguous lock ----

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the needs-operator and skip messages point to `gate8-queue.mjs clear-ambiguous <item>`, never to deleting the lock', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 try {
  const a = await claimItem({owner: 'A', item: 'recFIXTURE', lock: fileClaimLock(lockPath), get: async () => ready(), patch: async () => { throw timeoutError(); }, save() {}});
  assert.equal(a.action, 'needs-operator'); assert.equal(a.clearCommand, 'node gate8-queue.mjs clear-ambiguous recFIXTURE');
  const h = fileClaimLock(lockPath).holder();
  assert.equal(h.state, 'ambiguous'); assert.equal(h.item, 'recFIXTURE'); assert.equal(h.step, 'owner');
  assert.ok(Number.isFinite(Date.parse(h.patchStartedAt)), 'lock records when the ambiguous PATCH started');
  const b = await claimItem({owner: 'B', item: 'recFIXTURE', lock: fileClaimLock(lockPath), get: async () => assert.fail(), patch: async () => assert.fail(), save() {}});
  for (const m of [a.message, b.message]) { assert.match(m, new RegExp(esc('gate8-queue.mjs clear-ambiguous recFIXTURE'))); assert.match(m, /Do not delete/); assert.doesNotMatch(m, /remove .*manually/); }
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('patchStartedAt is written BEFORE the PATCH is sent', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'l');
 try {
  const seen = [];
  await claimItem({owner: 'o', lock: fileClaimLock(lockPath), get: (() => { let n = 0; return async () => ({fields: {Status: 'Ready', 'Claimed By': n++ ? 'o' : ''}}); })(),
   patch: async f => { seen.push(fileClaimLock(lockPath).holder()); return {}; }, save() {}});
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(h => [h.state, h.step, typeof h.patchStartedAt]), [['patching', 'owner', 'string'], ['patching', 'doing', 'string']]);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Virtual clock + shared last-writer-wins record. A's owner PATCH times out
// and is still in flight (delayed()).
async function ambiguousA(dir, clock) {
 const lockPath = path.join(dir, 'gate8-claim.lock');
 const record = ready(); let delayed = null;
 const lock = () => fileClaimLock(lockPath, {now: () => clock.t});
 const get = async () => structuredClone(record);
 const a = await claimItem({owner: 'A', item: 'rec1', lock: lock(), get, patch: async f => { delayed = () => Object.assign(record.fields, f); throw timeoutError(); }, save: () => assert.fail()});
 assert.equal(a.action, 'needs-operator');
 return {lockPath, record, lock, get, delayed: () => delayed()};
}

test('clear-ambiguous before the quiescence window is refused and keeps the lock', async () => {
 const dir = tmp(); const clock = {t: Date.parse('2026-11-22T10:00:00Z')};
 try {
  const s = await ambiguousA(dir, clock);
  for (const dt of [0, 60_000, CLEAR_QUIESCENCE_MS - 1]) {
   clock.t = Date.parse('2026-11-22T10:00:00Z') + dt;
   const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: async () => assert.fail('no Queue read inside the window'), pause: async () => assert.fail()});
   assert.equal(out.action, 'refused'); assert.equal(out.reason, 'quiescence-window'); assert.equal(out.waitMs, CLEAR_QUIESCENCE_MS - dt);
   assert.equal(fs.existsSync(s.lockPath), true);
  }
  assert.ok(CLEAR_QUIESCENCE_MS >= 10 * 60 * 1000, 'window is at least 10 minutes');
  // A clear for another item is refused too.
  clock.t += CLEAR_QUIESCENCE_MS;
  const wrong = await clearAmbiguousLock({lock: s.lock(), item: 'recOTHER', get: async () => assert.fail(), pause: async () => {}});
  assert.equal(wrong.reason, 'wrong-item'); assert.equal(fs.existsSync(s.lockPath), true);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a delayed PATCH landing within the window is blocked (refused) and then reported as landed; the next claimer cannot be overwritten', async () => {
 const dir = tmp(); const t0 = Date.parse('2026-11-22T10:00:00Z'); const clock = {t: t0};
 try {
  const s = await ambiguousA(dir, clock);
  clock.t = t0 + 30_000;
  assert.equal((await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get, pause: async () => {}})).reason, 'quiescence-window');
  // The reviewer's sequence: B tries to claim while A's PATCH is in flight -> lock-held skip.
  const b1 = await claimItem({owner: 'B', item: 'rec1', lock: s.lock(), get: s.get, patch: async () => assert.fail(), save: () => assert.fail()});
  assert.equal(b1.reason, 'claim-lock-held');
  s.delayed(); // A's PATCH lands inside the window
  clock.t = t0 + CLEAR_QUIESCENCE_MS;
  const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get, pause: async () => {}});
  assert.equal(out.action, 'cleared'); assert.equal(out.patchLanded, true); assert.equal(out.record['Claimed By'], 'A');
  assert.match(out.message, /landed/); assert.equal(fs.existsSync(s.lockPath), false);
  const b2 = await claimItem({owner: 'B', item: 'rec1', lock: s.lock(), get: s.get, patch: async () => assert.fail('B must not PATCH an owned record'), save: () => assert.fail()});
  assert.equal(b2.action, 'skip'); assert.equal(b2.claimed, true); assert.equal(s.record.fields['Claimed By'], 'A');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a PATCH landing between the two settle reads is detected: clear refused, lock kept', async () => {
 const dir = tmp(); const t0 = Date.parse('2026-11-22T10:00:00Z'); const clock = {t: t0};
 try {
  const s = await ambiguousA(dir, clock);
  clock.t = t0 + CLEAR_QUIESCENCE_MS + 1;
  const pauses = [];
  const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get, pause: async ms => { pauses.push(ms); s.delayed(); }});
  assert.equal(out.action, 'refused'); assert.equal(out.reason, 'record-changing'); assert.ok(pauses[0] >= 1000, 'reads are seconds apart');
  assert.equal(fs.existsSync(s.lockPath), true);
  // A later clear sees a stable record and reports the landed PATCH.
  const again = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get, pause: async () => {}});
  assert.equal(again.action, 'cleared'); assert.equal(again.patchLanded, true);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('clear-ambiguous after the window succeeds and reports a PATCH that did not land; the next claimer then claims', async () => {
 const dir = tmp(); const t0 = Date.parse('2026-11-22T10:00:00Z'); const clock = {t: t0};
 try {
  const s = await ambiguousA(dir, clock);
  clock.t = t0 + CLEAR_QUIESCENCE_MS;
  const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get, pause: async () => {}});
  assert.equal(out.action, 'cleared'); assert.equal(out.patchLanded, false); assert.match(out.message, /did not land/);
  assert.deepEqual(fs.readdirSync(dir), [], 'lock and clear mutex removed');
  const b = await claimItem({owner: 'B', item: 'rec1', lock: s.lock(), get: s.get, patch: async f => Object.assign(s.record.fields, f), save() {}});
  assert.equal(b.action, 'claimed'); assert.equal(s.record.fields['Claimed By'], 'B');
  assert.equal((await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get})).action, 'no-lock');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('clear-ambiguous never clears a running claimer, and concurrent clears are serialized', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'l');
 try {
  const lock = fileClaimLock(lockPath, {now: () => Date.parse('2026-11-22T10:00:00Z')});
  assert.equal(lock.acquire('live', {item: 'rec1'}), true);
  const later = fileClaimLock(lockPath, {now: () => Date.parse('2026-11-23T10:00:00Z')});
  const out = await clearAmbiguousLock({lock: later, item: 'rec1', get: async () => assert.fail(), pause: async () => {}});
  assert.equal(out.reason, 'claimer-running'); assert.equal(fs.existsSync(lockPath), true);
  // Dead holder (crash) past the window: cleared.
  const dead = await clearAmbiguousLock({lock: later, item: 'rec1', get: async () => ready(), pause: async () => {}, isAlive: () => false});
  assert.equal(dead.action, 'cleared');
  fs.writeFileSync(lockPath + '.clear', '{}');
  assert.equal(lock.acquire('x', {item: 'rec1'}), true);
  assert.equal((await clearAmbiguousLock({lock: later, item: 'rec1', get: async () => assert.fail(), isAlive: () => false})).reason, 'clear-in-progress');
  assert.equal(fs.existsSync(lockPath), true);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('loopback: A times out, a clear inside the window is refused, A\'s delayed PATCH lands, B never claims over it', async () => {
 // Real fetch + AbortSignal.timeout against a local HTTP server that holds
 // A's owner PATCH and applies it later (the reviewer's reproduction).
 const record = {id: 'rec1', fields: {Status: 'Ready', 'Claimed By': ''}}; let heldPatch = null;
 const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
   const who = req.url.split('/')[1];
   if (req.method === 'PATCH' && who === 'A' && !heldPatch) { heldPatch = () => { Object.assign(record.fields, JSON.parse(body).fields); try { res.end(JSON.stringify(record)); } catch {} }; return; }
   if (req.method === 'PATCH') Object.assign(record.fields, JSON.parse(body).fields);
   res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(record));
  });
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock'); const t0 = Date.now(); const clock = {t: t0};
 const api = who => async (method, fields) => { const r = await fetch(`${base}/${who}`, {method, headers: {'Content-Type': 'application/json'}, body: fields ? JSON.stringify({fields}) : undefined, signal: AbortSignal.timeout(300)});
  if (!r.ok) throw Object.assign(Error(`HTTP ${r.status}`), {httpStatus: r.status}); return r.json(); };
 const side = who => ({item: 'rec1', lock: fileClaimLock(lockPath, {now: () => clock.t}), get: () => api(who)('GET'), patch: f => api(who)('PATCH', f)});
 try {
  const a = await claimItem({owner: 'A', ...side('A'), save: () => assert.fail()});
  assert.equal(a.action, 'needs-operator');
  const early = await clearAmbiguousLock({...side('op'), pause: async () => {}});
  assert.equal(early.reason, 'quiescence-window'); assert.equal(fs.existsSync(lockPath), true);
  const b = await claimItem({owner: 'B', ...side('B'), save: () => assert.fail()});
  assert.equal(b.reason, 'claim-lock-held');
  heldPatch(); // A's delayed PATCH lands
  clock.t = t0 + CLEAR_QUIESCENCE_MS;
  const ok = await clearAmbiguousLock({...side('op'), pause: ms => new Promise(r => setTimeout(r, Math.min(ms, 20)))});
  assert.equal(ok.action, 'cleared'); assert.equal(ok.patchLanded, true);
  const b2 = await claimItem({owner: 'B', ...side('B'), save: () => assert.fail()});
  assert.equal(b2.action, 'skip'); assert.equal(record.fields['Claimed By'], 'A');
 } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, {recursive: true, force: true}); }
});
