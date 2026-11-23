import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {claimItem, fileClaimLock, clearAmbiguousLock, LOCK_FORMAT} from '../../scripts/gate8/claim.mjs';
import {createAirtableApi} from '../../scripts/gate8/airtable-api.mjs';

const claimUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/gate8/claim.mjs')).href;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gate8-claim-test-'));
const T0 = Date.parse('2026-11-22T10:00:00Z');
// A Queue read. The clock-free clear ignores any Date header, so reads carry
// none here (the attack tests below send hostile ones over HTTP).
const at = fields => ({fields: {...fields}});
const stamped = record => structuredClone(record);

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
  const out = await claimItem({owner: 'o1', lock: fileClaimLock(lockPath), get: async () => at(fields), patch: async f => Object.assign(fields, f), save: o => { saved = o; }});
  assert.deepEqual(out, {action: 'claimed', owner: 'o1'}); assert.equal(saved, 'o1'); assert.equal(fs.existsSync(lockPath), false);
  const other = fileClaimLock(lockPath); assert.equal(other.acquire('stale'), true);
  const skip = await claimItem({owner: 'o2', lock: fileClaimLock(lockPath), get: async () => assert.fail('no Queue read'), patch: async () => assert.fail('no Queue write'), save: () => assert.fail('no save')});
  assert.equal(skip.action, 'skip'); assert.equal(skip.reason, 'claim-lock-held'); assert.equal(skip.holder.owner, 'stale');
  assert.equal(fs.existsSync(lockPath), true, 'a foreign lock is never removed by a skipping claimer');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

const ready = () => at({Status: 'Ready', 'Claimed By': ''});
// What fetch with AbortSignal.timeout throws in scripts/gate8/airtable-api.mjs.
const timeoutError = () => new DOMException('deadline', 'TimeoutError');

test('review blocker 1: a timed-out PATCH that lands later cannot give a second claimer ownership', async () => {
 // Shared last-writer-wins record. A's owner PATCH times out but is applied
 // after B's claim would otherwise have completed.
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 try {
  const record = ready(); let delayed = null;
  const get = async () => stamped(record);
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
   const run = claimItem({owner: 'o', lock: fileClaimLock(lockPath), get: (() => { let n = 0; return async () => at({Status: 'Ready', 'Claimed By': n++ ? 'o' : ''}); })(),
    patch: (() => { let k = 0; return async () => { k++; if ((step === 'owner' && k === 1) || (step === 'doing' && k === 2)) throw err; return {}; }; })(), save: () => assert.fail('no save')});
   if (want === 'throws') await assert.rejects(run, /HTTP 422/);
   else assert.equal((await run).action, want);
   assert.equal(fs.existsSync(lockPath), kept, `${err.message} at ${step}`);
  }
  // Readback mismatch after a confirmed PATCH answer: release is allowed.
  const lockPath = path.join(dir, 'l-readback');
  await assert.rejects(claimItem({owner: 'o1', lock: fileClaimLock(lockPath), get: (() => { let n = 0; return async () => at({Status: 'Ready', 'Claimed By': n++ ? 'someone-else' : ''}); })(), patch: async () => ({}), save: () => assert.fail('no save')}), /readback mismatch/);
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
  const out = await claimItem({owner: 'o2', lock: fileClaimLock(lockPath), get: async () => stamped(record), patch: async f => Object.assign(record.fields, f), save() {}});
  assert.equal(out.action, 'claimed'); assert.deepEqual(fs.readdirSync(dir), []);
 } finally { Object.assign(fs, real); fs.rmSync(dir, {recursive: true, force: true}); }
});

// ---- clear-ambiguous: the only supported way to clear an ambiguous lock ----
//
// Clock-free rule: the lock durably records the exact PATCH fields and the
// record values that prove the PATCH applied (`expect`, incl. the claim id
// `Claimed At`). The clear succeeds only when the record shows `expect`;
// otherwise it refuses, unless --force-accept-risk (removes with a warning).

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the needs-operator and skip messages point to `gate8-queue.mjs clear-ambiguous <item>`, never to deleting the lock', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 try {
  const a = await claimItem({owner: 'A', item: 'recFIXTURE', lock: fileClaimLock(lockPath), get: async () => ready(), patch: async () => { throw timeoutError(); }, save() {}});
  assert.equal(a.action, 'needs-operator'); assert.equal(a.clearCommand, 'node gate8-queue.mjs clear-ambiguous recFIXTURE');
  const h = fileClaimLock(lockPath).holder();
  assert.equal(h.state, 'ambiguous'); assert.equal(h.item, 'recFIXTURE'); assert.equal(h.step, 'owner'); assert.equal(h.format, LOCK_FORMAT);
  const b = await claimItem({owner: 'B', item: 'recFIXTURE', lock: fileClaimLock(lockPath), get: async () => assert.fail(), patch: async () => assert.fail(), save() {}});
  for (const m of [a.message, b.message]) { assert.match(m, new RegExp(esc('gate8-queue.mjs clear-ambiguous recFIXTURE'))); assert.match(m, /Do not delete/); assert.doesNotMatch(m, /remove .*manually/); }
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the lock records the exact PATCH fields and the expected record values (owner + claim id) before each PATCH is sent', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'l');
 try {
  const seen = []; let n = 0; const sent = [];
  await claimItem({owner: 'o', lock: fileClaimLock(lockPath, {now: () => T0 + 1234}), get: async () => at({Status: 'Ready', 'Claimed By': n++ ? 'o' : ''}),
   patch: async f => { sent.push(f); seen.push(fileClaimLock(lockPath).holder()); return {}; }, save() {}});
  const claimId = new Date(T0 + 1000).toISOString();
  assert.deepEqual(sent, [{'Claimed By': 'o', 'Claimed At': claimId}, {Status: 'Doing'}]);
  assert.deepEqual(seen.map(h => [h.state, h.step, h.patch, h.expect]), [
   ['patching', 'owner', sent[0], {'Claimed By': 'o', 'Claimed At': claimId}],
   ['patching', 'doing', sent[1], {Status: 'Doing', 'Claimed By': 'o', 'Claimed At': claimId}]]);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('fsync: the lock file and its directory are fsynced before the PATCH is sent (fs stubbed, calls counted)', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'l');
 const orig = {fsyncSync: fs.fsyncSync, fdatasyncSync: fs.fdatasyncSync, openSync: fs.openSync, closeSync: fs.closeSync};
 const ops = []; const dirFds = new Set(); let fileSyncs = 0, dirSyncs = 0;
 try {
  fs.openSync = (p, ...rest) => { const fd = orig.openSync(p, ...rest); if (path.resolve(String(p)) === dir) dirFds.add(fd); return fd; };
  fs.closeSync = fd => { dirFds.delete(fd); return orig.closeSync(fd); };
  fs.fsyncSync = fd => { if (dirFds.has(fd)) { dirSyncs++; ops.push('fsync-dir'); } else { fileSyncs++; ops.push('fsync-file'); } return orig.fsyncSync(fd); };
  let n = 0; const atPatch = [];
  const out = await claimItem({owner: 'A', lock: fileClaimLock(lockPath), get: async () => at({Status: 'Ready', 'Claimed By': n++ ? 'A' : ''}),
   patch: async f => { atPatch.push({fileSyncs, dirSyncs, holder: JSON.parse(fs.readFileSync(lockPath, 'utf8'))}); ops.push('PATCH'); return {}; }, save() {}});
  assert.equal(out.action, 'claimed');
  // acquire (file + dir) and the owner-step mark (file + dir) precede the first PATCH.
  assert.ok(atPatch[0].fileSyncs >= 2 && atPatch[0].dirSyncs >= 2, JSON.stringify(atPatch[0]));
  assert.ok(atPatch[1].fileSyncs >= atPatch[0].fileSyncs + 1 && atPatch[1].dirSyncs >= atPatch[0].dirSyncs + 1, 'the Doing-step record is fsynced before the Doing PATCH');
  assert.deepEqual(atPatch.map(p => p.holder.step), ['owner', 'doing']);
  // Each PATCH is immediately preceded by fsync of the file and then the directory.
  for (const i of ops.flatMap((o, k) => o === 'PATCH' ? [k] : [])) assert.deepEqual(ops.slice(i - 2, i), ['fsync-file', 'fsync-dir']);
 } finally { Object.assign(fs, orig); fs.rmSync(dir, {recursive: true, force: true}); }
});

// A's owner PATCH times out and is still in flight; shared last-writer-wins record.
async function ambiguousA(dir, local = {t: T0}) {
 const lockPath = path.join(dir, 'gate8-claim.lock');
 const record = ready(); let delayed = null;
 const lock = () => fileClaimLock(lockPath, {now: () => local.t});
 const get = async () => stamped(record);
 const a = await claimItem({owner: 'A', item: 'rec1', lock: lock(), get, patch: async f => { delayed = () => Object.assign(record.fields, f); throw timeoutError(); }, save: () => assert.fail()});
 assert.equal(a.action, 'needs-operator');
 return {lockPath, record, lock, get, delayed: () => delayed()};
}

test('the PATCH has not applied: clear-ambiguous refuses, keeps the lock and explains the options; B cannot claim; A\'s late PATCH overwrites nobody', async () => {
 const dir = tmp();
 try {
  const s = await ambiguousA(dir);
  for (let i = 0; i < 3; i++) {
   const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get});
   assert.equal(out.action, 'refused'); assert.equal(out.reason, 'patch-outcome-unknown');
   assert.match(out.message, /may still apply/); assert.match(out.message, /rerun/); assert.match(out.message, /--force-accept-risk/);
   assert.equal(fs.existsSync(s.lockPath), true);
  }
  const b = await claimItem({owner: 'B', item: 'rec1', lock: s.lock(), get: s.get, patch: async () => assert.fail(), save: () => assert.fail()});
  assert.equal(b.reason, 'claim-lock-held');
  s.delayed(); assert.equal(s.record.fields['Claimed By'], 'A');
  // Wrong item: refused before any read.
  const wrong = await clearAmbiguousLock({lock: s.lock(), item: 'recOTHER', get: async () => assert.fail()});
  assert.equal(wrong.reason, 'wrong-item'); assert.equal(fs.existsSync(s.lockPath), true);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a landed PATCH is accepted as A\'s claim: the clear reports A as owner and removes the lock; B then skips the owned record', async () => {
 const dir = tmp();
 try {
  const s = await ambiguousA(dir);
  s.delayed(); // A's PATCH lands at any time; no waiting needed
  const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get});
  assert.equal(out.action, 'cleared'); assert.equal(out.outcome, 'patch-applied'); assert.equal(out.owner, 'A');
  assert.equal(out.record['Claimed By'], 'A'); assert.match(out.message, /has applied/);
  assert.deepEqual(fs.readdirSync(dir), [], 'lock and clear mutex removed');
  const b = await claimItem({owner: 'B', item: 'rec1', lock: s.lock(), get: s.get, patch: async () => assert.fail('B must not PATCH an owned record'), save: () => assert.fail()});
  assert.equal(b.action, 'skip'); assert.equal(b.claimed, true); assert.equal(s.record.fields['Claimed By'], 'A');
  assert.equal((await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get})).action, 'no-lock');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('match is exact: another owner, another claim id, or a Doing step whose Status PATCH has not applied are all refused', async () => {
 const dir = tmp();
 try {
  const s = await ambiguousA(dir);
  const claimId = fileClaimLock(s.lockPath).holder().expect['Claimed At'];
  for (const f of [{'Claimed By': 'B', 'Claimed At': claimId}, {'Claimed By': 'A', 'Claimed At': '2026-11-22T09:59:59.000Z'}, {'Claimed By': 'A'}]) {
   const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: async () => at({Status: 'Ready', ...f})});
   assert.equal(out.reason, 'patch-outcome-unknown', JSON.stringify(f)); assert.equal(fs.existsSync(s.lockPath), true);
  }
  // Airtable's normalized datetime form of the same instant is accepted.
  const ok = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: async () => at({Status: 'Ready', 'Claimed By': 'A', 'Claimed At': claimId.replace('.000Z', 'Z')})});
  assert.equal(ok.outcome, 'patch-applied');
  // Doing step ambiguous: the owner PATCH applied, the Status PATCH may still be pending.
  const record = ready(); let n = 0; const lockPath = path.join(dir, 'd.lock');
  const d = await claimItem({owner: 'A', item: 'rec1', lock: fileClaimLock(lockPath), get: async () => stamped(record),
   patch: async f => { if (n++) throw timeoutError(); Object.assign(record.fields, f); return {}; }, save: () => assert.fail()});
  assert.equal(d.action, 'needs-operator');
  const no = await clearAmbiguousLock({lock: fileClaimLock(lockPath), item: 'rec1', get: async () => stamped(record)});
  assert.equal(no.reason, 'patch-outcome-unknown'); assert.equal(fs.existsSync(lockPath), true);
  record.fields.Status = 'Doing';
  assert.equal((await clearAmbiguousLock({lock: fileClaimLock(lockPath), item: 'rec1', get: async () => stamped(record)})).outcome, 'patch-applied');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('--force-accept-risk removes the lock and logs an explicit warning; without it the same lock is refused', async () => {
 const dir = tmp();
 try {
  const s = await ambiguousA(dir);
  assert.equal((await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get})).action, 'refused');
  const warnings = [];
  const out = await clearAmbiguousLock({lock: s.lock(), item: 'rec1', get: s.get, forceAcceptRisk: true, warn: m => warnings.push(m)});
  assert.equal(out.action, 'force-cleared'); assert.equal(out.reason, 'patch-outcome-unknown');
  assert.equal(warnings.length, 1); assert.match(warnings[0], /^WARNING: --force-accept-risk/); assert.match(warnings[0], /overwrite a later claimer/);
  assert.equal(out.warning, warnings[0]); assert.equal(fs.existsSync(s.lockPath), false);
  // The documented risk is real: B claims, then A's late PATCH overwrites B.
  const b = await claimItem({owner: 'B', item: 'rec1', lock: s.lock(), get: s.get, patch: async f => Object.assign(s.record.fields, f), save() {}});
  assert.equal(b.action, 'claimed'); s.delayed(); assert.equal(s.record.fields['Claimed By'], 'A');
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('legacy locks without recorded PATCH values are refused (even years later); only --force-accept-risk removes them', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 try {
  const legacy = [{owner: 'A', pid: 2147483647, at: new Date(T0).toISOString(), state: 'claiming'},
   {owner: 'A', pid: 2147483647, item: 'rec1', state: 'patching', step: 'owner', patchStartedAt: new Date(T0).toISOString()},
   {owner: 'A', pid: 2147483647, item: 'rec1', state: 'ambiguous', step: 'owner', patchServerStart: new Date(T0).toISOString(), acquiredServerAt: new Date(T0).toISOString()},
   {owner: 'A', pid: 2147483647, item: 'rec1', format: LOCK_FORMAT, state: 'ambiguous', step: 'owner'}];
  for (const h of legacy) {
   fs.writeFileSync(lockPath, JSON.stringify(h));
   const out = await clearAmbiguousLock({lock: fileClaimLock(lockPath), item: 'rec1', get: async () => assert.fail('refused before any read'), isAlive: () => false});
   assert.equal(out.action, 'refused'); assert.equal(out.reason, 'legacy-lock', JSON.stringify(h)); assert.match(out.message, /--force-accept-risk/);
   assert.equal(fs.readFileSync(lockPath, 'utf8'), JSON.stringify(h));
   const warnings = [];
   const forced = await clearAmbiguousLock({lock: fileClaimLock(lockPath), item: 'rec1', get: async () => assert.fail(), isAlive: () => false, forceAcceptRisk: true, warn: m => warnings.push(m)});
   assert.equal(forced.action, 'force-cleared'); assert.equal(warnings.length, 1); assert.equal(fs.existsSync(lockPath), false);
  }
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a current-format claiming lock of a dead claimer (no PATCH recorded, hence none sent) is cleared; a live claimer never is; clears are serialized', async () => {
 const dir = tmp(); const lockPath = path.join(dir, 'l');
 try {
  const lock = fileClaimLock(lockPath);
  assert.equal(lock.acquire('live', {item: 'rec1'}), true);
  const out = await clearAmbiguousLock({lock, item: 'rec1', get: async () => assert.fail()});
  assert.equal(out.reason, 'claimer-running'); assert.equal(fs.existsSync(lockPath), true);
  fs.writeFileSync(lockPath + '.clear', '{}');
  assert.equal((await clearAmbiguousLock({lock, item: 'rec1', get: async () => assert.fail(), isAlive: () => false})).reason, 'clear-in-progress');
  fs.rmSync(lockPath + '.clear');
  const ok = await clearAmbiguousLock({lock, item: 'rec1', get: async () => assert.fail('no read needed'), isAlive: () => false});
  assert.equal(ok.action, 'cleared'); assert.equal(ok.outcome, 'no-patch-sent'); assert.deepEqual(fs.readdirSync(dir), []);
 } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Loopback fake Airtable through the real scripts/gate8/airtable-api.mjs:
// real HTTP, last-writer-wins, A's first owner PATCH is held (heldPatch()
// applies it later). Every response carries the Date header q.date (hostile
// values in the attack tests) and the lock's local clock is q.local.
async function loopbackQueue() {
 const record = {id: 'rec1', fields: {Status: 'Ready', 'Claimed By': ''}}; const q = {record, date: new Date(T0).toUTCString(), local: {t: T0}, heldPatch: null};
 const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
   const who = req.url.split('/')[1];
   res.setHeader('Date', typeof q.date === 'function' ? q.date() : q.date);
   if (req.method === 'PATCH' && who === 'A' && !q.heldPatch) { q.heldPatch = () => { Object.assign(record.fields, JSON.parse(body).fields); try { res.end(JSON.stringify(record)); } catch {} }; return; }
   if (req.method === 'PATCH') Object.assign(record.fields, JSON.parse(body).fields);
   res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(record));
  });
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 q.side = (lockPath, who) => { const api = createAirtableApi({base: `${base}/${who}`, token: 'FAKE', deadlineMs: 200, pause: async () => {}});
  return {item: 'rec1', lock: fileClaimLock(lockPath, {now: () => q.local.t}), get: () => api('GET'), patch: f => api('PATCH', '', {fields: f})}; };
 q.close = async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
 return q;
}

// The reviewer's attacks (/tmp/gate8-review-befa310.*/attack.mjs,
// /tmp/gate8-review-0ad0135.*/attack.mjs). Each sets the Date header seen
// during A's claim (`pre`) and during the clear (`post`) so that a window
// measured on Date headers is "over" although A's PATCH is ~1 s old and
// still in flight; `local` moves the lock's local clock instead. All fail on
// befa310 except the local-clock jump, which fails on 0ad0135.
const httpDate = t => new Date(t).toUTCString();
const tenMin = 10 * 60_000;
for (const [name, pre, post, local] of [
 ['stale Date header (proxy cache 10 min old at the PATCH)', httpDate(T0 - tenMin), httpDate(T0 + 1000)],
 ['invalid Date header "0" at the PATCH', '0', httpDate(T0 + 1000)],
 ['Date header going backwards between the clear reads', httpDate(T0), (() => { let n = 0; return () => httpDate(T0 + tenMin + (n++ ? 10_000 : 20_000)); })()],
 ['local clock jumps forward 10 min', httpDate(T0), httpDate(T0 + 1000), T0 + tenMin],
]) test(`loopback attack (${name}): A's PATCH has not applied, so the clear refuses and B never gets overwritten`, async () => {
 const q = await loopbackQueue(); const dir = tmp(); const lockPath = path.join(dir, 'gate8-claim.lock');
 try {
  q.date = pre;
  const a = await claimItem({owner: 'A', ...q.side(lockPath, 'A'), save: () => assert.fail()});
  assert.equal(a.action, 'needs-operator');
  q.date = post; if (local !== undefined) q.local.t = local;
  const out = await clearAmbiguousLock({...q.side(lockPath, 'op'), isAlive: () => false, pause: async () => {}});
  // Safety first: B tries to claim, then A's in-flight PATCH lands.
  const b = await claimItem({owner: 'B', ...q.side(lockPath, 'B'), save() {}}).catch(e => ({action: 'error', message: e.message}));
  q.heldPatch();
  assert.ok(!(b.action === 'claimed' && q.record.fields['Claimed By'] !== 'B'), `two owners: clear=${out.action}/${out.reason}, B claimed, record names ${q.record.fields['Claimed By']}`);
  assert.equal(out.action, 'refused'); assert.equal(out.reason, 'patch-outcome-unknown'); assert.equal(fs.existsSync(lockPath), true);
  assert.equal(b.reason, 'claim-lock-held'); assert.equal(q.record.fields['Claimed By'], 'A');
  // Once A's PATCH has applied, the same hostile clocks do not prevent the clear.
  const ok = await clearAmbiguousLock({...q.side(lockPath, 'op'), isAlive: () => false, pause: async () => {}});
  assert.equal(ok.action, 'cleared'); assert.equal(ok.outcome, 'patch-applied'); assert.equal(ok.owner, 'A');
  const b2 = await claimItem({owner: 'B', ...q.side(lockPath, 'B'), save: () => assert.fail()});
  assert.equal(b2.action, 'skip'); assert.equal(q.record.fields['Claimed By'], 'A');
 } finally { await q.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});
