import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {claimItem, fileClaimLock} from '../../scripts/gate8/claim.mjs';

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
  assert.match(b.message, /ambiguous/); assert.ok(b.message.includes(lockPath), 'skip message names the lock path to remove');
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
