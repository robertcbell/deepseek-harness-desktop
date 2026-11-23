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
// now() is the local wall clock used for the informational local timestamps in
// the lock (injectable for the explorer and tests). The clear window never
// uses it: it uses the server-clock fields acquiredServerAt/patchServerStart.
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
// CLEAR_QUIESCENCE_MS: how long after the last PATCH the claimer STARTED a
// clear is refused. The window is measured on AIRTABLE'S clock, never the
// local one: just before every PATCH the lock records patchServerStart, the
// HTTP Date header of the GET that immediately preceded it, and the clear
// compares that with the Date header of its own reads. A local wall-clock
// jump (NTP step, manual change) therefore cannot shorten the window.
// Rationale for 10 min: the client aborts every Airtable request after
// ownershipReadPolicy.deadlineMs (20 s, scripts/gate8/retry-read.mjs) and a
// dead process closes its socket, so no request bytes leave the host more
// than ~20 s after the PATCH started. Airtable documents no server-side
// request lifetime; 10 minutes is a conservative bound, 30x the client
// deadline, on how long an already-received PATCH could still be applied.
// This is a TIMING ASSUMPTION, not a guarantee. It also assumes the step from
// the preceding GET's answer to the PATCH leaving the host is short (one
// local lock write; a host suspend exactly there eats into the margin), that
// Airtable's clock does not step backwards by minutes, and it accepts the
// Date header's 1 s resolution. The two identical reads below are a second,
// independent check.
export const CLEAR_QUIESCENCE_MS = 10 * 60 * 1000;
// Gap between the two record reads that must be identical before clearing.
export const CLEAR_SETTLE_MS = 5000;

// Server time of a Queue read: get() must return the record with
// `serverDate`, the response's HTTP Date header (scripts/gate8/airtable-api.mjs
// attaches it). NaN when missing or unparseable.
export const serverTime = r => typeof r?.serverDate === 'string' ? Date.parse(r.serverDate) : NaN;
const serverIso = (r, what) => {
 const t = serverTime(r);
 if (!Number.isFinite(t)) throw Object.assign(Error(`The Queue read before ${what} carried no parseable server Date header; nothing was sent (the clear window is measured on Airtable's clock).`), { code: 'ENOSERVERTIME' });
 return new Date(t).toISOString();
};

const clearCommand = item => `node gate8-queue.mjs clear-ambiguous ${item ?? '<item>'}`;
const operatorAction = item => `Do not delete the lock file: a timed-out PATCH can still land. Run \`${clearCommand(item)}\`; it refuses until Airtable's clock shows ${CLEAR_QUIESCENCE_MS / 60000} minutes since the last PATCH started and the record reads the same twice.`;
const stableJson = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
const pidAlive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const preClaim = r => r?.fields?.Status === 'Ready' && !r?.fields?.['Claimed By'];

// clearAmbiguousLock({lock, item, get}): remove a claim lock left by an
// ambiguous PATCH (state 'ambiguous') or by a dead claimer, only when no
// claim PATCH can still land:
//  1. the lock's state is 'ambiguous', or its holder process is dead
//     (a live claimer's lock is never cleared);
//  2. the lock records a server-clock start: patchServerStart for any lock
//     that may have sent a PATCH, or, for a lock still in state 'claiming'
//     with no PATCH recorded, acquiredServerAt. Missing or unparseable ->
//     refused: such a lock (e.g. one written by an older claim.mjs, which
//     kept only local-clock times) is never cleared by this command;
//  3. both record reads carry a server Date and serverNow - start >=
//     quiescenceMs on each;
//  4. the two reads, settleMs apart, are identical; for a 'claiming' lock
//     both must also still show the pre-claim state (Ready, unclaimed);
//  5. the lock still has the content inspected in step 1.
// The local clock is never used for the window. Clears are serialized by a
// second O_EXCL file `<lock>.clear`. Returns {action:'cleared', patchLanded,
// record} or {action:'refused', reason, ...}; a refusal never removes the lock.
export async function clearAmbiguousLock({ lock, item, get, pause = ms => new Promise(r => setTimeout(r, ms)),
 quiescenceMs = CLEAR_QUIESCENCE_MS, settleMs = CLEAR_SETTLE_MS, isAlive = pidAlive }) {
 const refused = (reason, extra = {}) => ({ action: 'refused', reason, lockPath: lock.path, ...extra });
 const raw = () => { try { return fs.readFileSync(lock.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
 const mutex = `${lock.path}.clear`;
 try { fs.writeFileSync(mutex, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
 catch (e) { if (e.code === 'EEXIST') return refused('clear-in-progress', { message: `Another clear holds ${mutex}; if no clear is running, that file may be removed (it guards only clears, never claims).` }); throw e; }
 try {
  const seen = raw();
  if (seen === null) return { action: 'no-lock', lockPath: lock.path };
  let h; try { h = JSON.parse(seen); } catch { return refused('lock-unreadable'); }
  if (h.item && item && h.item !== item) return refused('wrong-item', { holder: h, message: `The lock is for item ${h.item}, not ${item}.` });
  if (h.state !== 'ambiguous' && isAlive(h.pid)) return refused('claimer-running', { holder: h, message: `Claimer pid ${h.pid} is still running; wait for it to finish.` });
  // Any sign of a PATCH (a non-claiming state or a recorded start) means the
  // window must run from the server-clock PATCH start.
  const mayHavePatched = h.state !== 'claiming' || 'patchStartedAt' in h || 'patchServerStart' in h;
  const start = Date.parse(mayHavePatched ? h.patchServerStart ?? '' : h.acquiredServerAt ?? '');
  if (!Number.isFinite(start)) return refused('no-server-time-in-lock', { holder: h, message: mayHavePatched
   ? 'The lock records no server-clock PATCH start (patchServerStart), so the time since the last PATCH started cannot be measured safely: its local-clock times may predate the PATCH or be skewed by a clock jump (such locks come only from an older claim.mjs). This command will not clear it; the lock is kept. Escalate to the Lead.'
   : 'The lock is in the claiming state and records no server-clock acquisition time (acquiredServerAt), so it may come from an older claim.mjs that could have sent a PATCH without recording it. It is treated as ambiguous and not cleared by this command; the lock is kept. Escalate to the Lead.' });
  const noServerTime = () => refused('no-server-time', { holder: h, message: 'A Queue read carried no parseable Date header, so the window cannot be measured on the server clock. Lock kept; retry later.' });
  const tooEarly = n => refused('quiescence-window', { holder: h, waitMs: quiescenceMs - (n - start),
   message: `A claim PATCH may still land. Retry after ${new Date(start + quiescenceMs).toISOString()} by Airtable's clock (${Math.ceil((quiescenceMs - (n - start)) / 1000)} s).` });
  const r1 = await get(); const n1 = serverTime(r1);
  if (!Number.isFinite(n1)) return noServerTime();
  if (n1 - start < quiescenceMs) return tooEarly(n1);
  await pause(settleMs);
  const r2 = await get(); const n2 = serverTime(r2);
  if (!Number.isFinite(n2)) return noServerTime();
  if (n2 - start < quiescenceMs) return tooEarly(n2);
  if (stableJson(r1?.fields) !== stableJson(r2?.fields)) return refused('record-changing', { holder: h, first: r1?.fields, second: r2?.fields,
   message: 'The record changed between two reads; a PATCH may still be landing. Lock kept; retry later.' });
  if (!mayHavePatched && !(preClaim(r1) && preClaim(r2))) return refused('not-pre-claim', { holder: h, record: r2?.fields,
   message: 'The lock records no PATCH, but the record no longer shows its pre-claim state (Ready, unclaimed). Lock kept; escalate to the Lead.' });
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

// get(): current record with `serverDate` (its HTTP Date header; a read
// without one stops the claim before any PATCH); patch(fields): PATCH the record; save(owner): persist
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
 const guardedPatch = async (fields, step, prev) => {
  // Record when this PATCH starts BEFORE sending it, on the server clock (the
  // Date of the GET just before it, prev). If that fails, nothing is sent
  // and the lock is released normally.
  lock.mark?.({ state: 'patching', step, patchStartedAt: stamp(), patchServerStart: serverIso(prev, `the ${step} PATCH`) });
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
  // Server-clock acquisition stamp, before any PATCH: a lock left in state
  // 'claiming' is measured from it (and must still read Ready/unclaimed).
  lock.mark?.({ acquiredServerAt: serverIso(r, 'the owner PATCH') });
  await guardedPatch({ 'Claimed By': owner, 'Claimed At': new Date().toISOString() }, 'owner', r);
  const rb = await get();
  if (rb.fields['Claimed By'] !== owner) throw Error('Claim readback mismatch');
  await guardedPatch({ Status: 'Doing' }, 'doing', rb);
  save(owner);
  return { action: 'claimed', owner };
 } catch (e) {
  if (!e?.ambiguous) throw e;
  return { action: 'needs-operator', reason: 'ambiguous-patch', lockPath: lock.path, error: e.message,
   clearCommand: clearCommand(item), message: `A claim PATCH may still be applied; the claim lock ${lock.path} is kept. ${operatorAction(item)}` };
 } finally { if (!keep) lock.release(); }
}
