import fs from 'node:fs';

// One Queue item has at most one owner.
//
// Airtable offers no conditional update (no If-Match/version check, no
// transaction): every PATCH is last-writer-wins, so GET-check-then-PATCH and a
// readback cannot exclude a second claimer. Exclusion therefore comes from a
// host-local lock file, held from the Ready/unclaimed check until the outcome
// of every claim PATCH is known. It serializes every claimer on this host that
// uses the same lock path. It does NOT exclude claimers on another host or a
// human editing the record.
//
// The lock file is created atomically WITH its metadata: the metadata is
// written to a private temp file, which is then hard-linked into place
// (link fails with EEXIST if the lock exists). A failed metadata write
// therefore never leaves a lock behind.
//
// now() is the wall clock used for every timestamp in the lock (injectable for
// the explorer and tests).
export function fileClaimLock(lockPath, { now = Date.now } = {}) {
 let seq = 0;
 const iso = () => new Date(now()).toISOString();
 const tmpName = () => `${lockPath}.tmp-${process.pid}-${++seq}-${Math.random().toString(36).slice(2)}`;
 const writeTemp = data => {
  const tmp = tmpName();
  try { fs.writeFileSync(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return tmp;
 };
 return {
  path: lockPath,
  now,
  acquire(owner, extra = {}) {
   const tmp = writeTemp({ ...extra, owner, pid: process.pid, at: iso(), state: 'claiming' });
   try { fs.linkSync(tmp, lockPath); return true; }
   catch (e) { if (e.code === 'EEXIST') return false; throw e; }
   finally { fs.rmSync(tmp, { force: true }); }
  },
  // Rewrite the held lock's metadata (atomic rename over our own lock). The
  // lock stays held even if this fails. It never re-creates a lock that is
  // gone (rename would do that silently), so a lost lock stops the claim.
  mark(fields) {
   const cur = this.holder();
   if (!cur) throw Object.assign(Error(`Claim lock ${lockPath} is no longer held`), { code: 'ELOCKLOST' });
   const tmp = writeTemp({ ...cur, ...fields, markedAt: iso() });
   try { fs.renameSync(tmp, lockPath); } finally { fs.rmSync(tmp, { force: true }); }
  },
  release() { fs.rmSync(lockPath, { force: true }); },
  holder() { try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return null; } },
 };
}

// A PATCH error is definite (the request was rejected and not applied) only
// for an HTTP 4xx answer. Timeouts, network errors, 5xx and anything else are
// ambiguous: Airtable may still apply the PATCH later.
export const definitePatchFailure = e => Number.isInteger(e?.httpStatus) && e.httpStatus >= 400 && e.httpStatus <= 499;

// ---- Clearing a lock left by an ambiguous PATCH (or a crash) --------------
//
// Never delete the lock file by hand. A timed-out PATCH may still be applied
// by Airtable after the claimer gave up; if the lock is removed first, the next
// claimer can claim and the late PATCH then overwrites its owner (reproduced
// on a loopback server). The only supported way to clear the lock is
// `node gate8-queue.mjs clear-ambiguous <item>`, which calls clearAmbiguousLock.
//
// CLEAR_QUIESCENCE_MS: how long after the last PATCH the claimer STARTED (the
// lock records patchStartedAt before every PATCH is sent) a clear is refused.
// Rationale: the client aborts every Airtable request after
// ownershipReadPolicy.deadlineMs (20 s, scripts/gate8/retry-read.mjs) and a
// dead process closes its socket, so no request bytes leave the host more
// than ~20 s after patchStartedAt. Airtable documents no server-side request
// lifetime; 10 minutes is a conservative bound, 30x the client deadline, on
// how long an already-received PATCH could still be applied. This is a
// TIMING ASSUMPTION, not a guarantee: a store that applies a request later
// than this could still overwrite a later claimer. The two identical reads
// below are a second, independent check for that case.
export const CLEAR_QUIESCENCE_MS = 10 * 60 * 1000;
// Gap between the two record reads that must be identical before clearing.
export const CLEAR_SETTLE_MS = 5000;

const clearCommand = item => `node gate8-queue.mjs clear-ambiguous ${item ?? '<item>'}`;
const operatorAction = item => `Do not delete the lock file: a timed-out PATCH can still land. Run \`${clearCommand(item)}\`; it refuses until ${CLEAR_QUIESCENCE_MS / 60000} minutes after the last PATCH started and the record reads the same twice.`;
const stableJson = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
const pidAlive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// clearAmbiguousLock({lock, item, get}): remove a claim lock left by an
// ambiguous PATCH (state 'ambiguous') or by a dead claimer, only when no
// claim PATCH can still land:
//  1. the lock's state is 'ambiguous', or its holder process is dead
//     (a live claimer's lock is never cleared);
//  2. now - (latest time recorded in the lock, incl. patchStartedAt)
//     >= quiescenceMs;
//  3. two record reads, settleMs apart, are identical;
//  4. the lock still has the content inspected in step 1.
// Clears are serialized by a second O_EXCL file `<lock>.clear`. Returns
// {action:'cleared', patchLanded, record} or {action:'refused', reason, ...};
// a refusal never removes the lock.
export async function clearAmbiguousLock({ lock, item, get, now = lock.now ?? Date.now, pause = ms => new Promise(r => setTimeout(r, ms)),
 quiescenceMs = CLEAR_QUIESCENCE_MS, settleMs = CLEAR_SETTLE_MS, isAlive = pidAlive }) {
 const refused = (reason, extra = {}) => ({ action: 'refused', reason, lockPath: lock.path, ...extra });
 const raw = () => { try { return fs.readFileSync(lock.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
 const mutex = `${lock.path}.clear`;
 try { fs.writeFileSync(mutex, JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() }), { flag: 'wx', mode: 0o600 }); }
 catch (e) { if (e.code === 'EEXIST') return refused('clear-in-progress', { message: `Another clear holds ${mutex}; if no clear is running, that file may be removed (it guards only clears, never claims).` }); throw e; }
 try {
  const seen = raw();
  if (seen === null) return { action: 'no-lock', lockPath: lock.path };
  let h; try { h = JSON.parse(seen); } catch { return refused('lock-unreadable'); }
  if (h.item && item && h.item !== item) return refused('wrong-item', { holder: h, message: `The lock is for item ${h.item}, not ${item}.` });
  if (h.state !== 'ambiguous' && isAlive(h.pid)) return refused('claimer-running', { holder: h, message: `Claimer pid ${h.pid} is still running; wait for it to finish.` });
  const times = [h.at, h.markedAt, h.patchStartedAt, h.ambiguousAt].map(t => Date.parse(t ?? '')).filter(Number.isFinite);
  if (!times.length || ((h.state === 'ambiguous' || h.state === 'patching') && !Number.isFinite(Date.parse(h.patchStartedAt ?? '')))) return refused('no-patch-start-time', { holder: h });
  const since = Math.max(...times), waited = now() - since;
  if (waited < quiescenceMs) return refused('quiescence-window', { holder: h, waitMs: quiescenceMs - waited,
   message: `A claim PATCH may still land. Retry after ${new Date(since + quiescenceMs).toISOString()} (${Math.ceil((quiescenceMs - waited) / 1000)} s).` });
  const r1 = await get(); await pause(settleMs); const r2 = await get();
  if (stableJson(r1?.fields) !== stableJson(r2?.fields)) return refused('record-changing', { holder: h, first: r1?.fields, second: r2?.fields,
   message: 'The record changed between two reads; a PATCH may still be landing. Lock kept; retry later.' });
  if (raw() !== seen) return refused('lock-changed', { message: 'The lock changed during the clear; nothing removed.' });
  fs.rmSync(lock.path);
  const f = r2.fields ?? {};
  const ownerLanded = f['Claimed By'] === h.owner;
  const patchLanded = h.step === 'doing' ? f.Status === 'Doing' : ownerLanded;
  return { action: 'cleared', lockPath: lock.path, holder: h, patchLanded, record: { Status: f.Status ?? null, 'Claimed By': f['Claimed By'] || null },
   message: patchLanded ? `${h.owner}'s ${h.step ?? 'claim'} PATCH landed: the record names ${f['Claimed By'] || '(none)'} with Status ${f.Status}; that claimer has exited, so review/reset the item.`
    : `${h.owner}'s ${h.step ?? 'claim'} PATCH did not land; the record is ${f.Status}/${f['Claimed By'] || '(unclaimed)'}.` };
 } finally { fs.rmSync(mutex, { force: true }); }
}

// get(): current record; patch(fields): PATCH the record; save(owner): persist
// local ownership. Returns {action:'claimed'} only while holding the lock.
// The lock is released only when no claim PATCH can still land: after the
// claim completes, after a skip/read failure, or after a definite (4xx)
// PATCH failure. An ambiguous PATCH result keeps the lock, marks it
// "ambiguous" and returns action 'needs-operator'. A lock left by a crash or
// an ambiguous PATCH makes later claims skip (fail closed) until an operator
// runs clearAmbiguousLock (`gate8-queue.mjs clear-ambiguous <item>`); nothing
// removes it automatically.
// item: the Queue record id (stored in the lock and named in the clear
// command).
export async function claimItem({ owner, get, patch, save, lock, item }) {
 if (!lock.acquire(owner, item ? { item } : {})) {
  const holder = lock.holder?.() ?? null;
  return { action: 'skip', reason: 'claim-lock-held', lockPath: lock.path, holder,
   message: `Claim lock ${lock.path} is held${holder?.state === 'ambiguous' ? ' after an ambiguous Queue PATCH' : ''} by ${holder?.owner ?? 'an unknown claimer'}. ${operatorAction(holder?.item ?? item)}` };
 }
 let keep = false;
 const stamp = () => new Date((lock.now ?? Date.now)()).toISOString();
 const guardedPatch = async (fields, step) => {
  // Record when this PATCH starts BEFORE sending it; if that write fails,
  // nothing is sent and the lock is released normally.
  lock.mark?.({ state: 'patching', step, patchStartedAt: stamp() });
  try { return await patch(fields); }
  catch (e) {
   if (definitePatchFailure(e)) throw e;
   keep = true;
   try { lock.mark?.({ state: 'ambiguous', step, ambiguousAt: stamp(), error: String(e?.message ?? e) }); } catch {}
   throw Object.assign(Error(`Ambiguous Queue PATCH (${step}): ${e?.message ?? e}`), { ambiguous: true, cause: e });
  }
 };
 try {
  const r = await get();
  if (r.fields.Status !== 'Ready' || r.fields['Claimed By']) return { action: 'skip', status: r.fields.Status, claimed: !!r.fields['Claimed By'] };
  await guardedPatch({ 'Claimed By': owner, 'Claimed At': new Date().toISOString() }, 'owner');
  if ((await get()).fields['Claimed By'] !== owner) throw Error('Claim readback mismatch');
  await guardedPatch({ Status: 'Doing' }, 'doing');
  save(owner);
  return { action: 'claimed', owner };
 } catch (e) {
  if (!e?.ambiguous) throw e;
  return { action: 'needs-operator', reason: 'ambiguous-patch', lockPath: lock.path, error: e.message,
   clearCommand: clearCommand(item), message: `A claim PATCH may still be applied; the claim lock ${lock.path} is kept. ${operatorAction(item)}` };
 } finally { if (!keep) lock.release(); }
}
