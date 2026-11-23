import fs from 'node:fs';
import path from 'node:path';

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
// Durability: every lock write is fsynced (the file, then its directory
// after the link/rename), so a PATCH is sent only after the lock record that
// describes it is on disk. A crash or power loss therefore never leaves a lock
// that hides a PATCH which was sent.
//
// now() is the local wall clock, used only for informational timestamps and
// the claim's `Claimed At` value (injectable for the explorer and tests). No
// safety decision depends on any clock.
export const LOCK_FORMAT = 'gate8-claim-lock/2';
export function fileClaimLock(lockPath, { now = Date.now } = {}) {
 let seq = 0;
 const iso = () => new Date(now()).toISOString();
 const dir = path.dirname(lockPath);
 const tmpName = () => `${lockPath}.tmp-${process.pid}-${++seq}-${Math.random().toString(36).slice(2)}`;
 const syncDir = () => { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
 const writeTemp = data => {
  const tmp = tmpName();
  try {
   const fd = fs.openSync(tmp, 'wx', 0o600);
   try { fs.writeSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return tmp;
 };
 return {
  path: lockPath,
  now,
  acquire(owner, extra = {}) {
   const tmp = writeTemp({ ...extra, format: LOCK_FORMAT, owner, pid: process.pid, at: iso(), state: 'claiming' });
   try { fs.linkSync(tmp, lockPath); }
   catch (e) { if (e.code === 'EEXIST') return false; throw e; }
   finally { fs.rmSync(tmp, { force: true }); }
   syncDir();
   return true;
  },
  // Rewrite the held lock's metadata (atomic rename over our own lock, then
  // fsync of the directory). The lock stays held even if this fails. It never
  // re-creates a lock that is gone (rename would do that silently), so a lost
  // lock stops the claim.
  mark(fields) {
   const cur = this.holder();
   if (!cur) throw Object.assign(Error(`Claim lock ${lockPath} is no longer held`), { code: 'ELOCKLOST' });
   const tmp = writeTemp({ ...cur, ...fields, markedAt: iso() });
   try { fs.renameSync(tmp, lockPath); } finally { fs.rmSync(tmp, { force: true }); }
   syncDir();
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
// on a loopback server). The supported way to clear the lock is
// `node gate8-queue.mjs clear-ambiguous <item>`, which calls clearAmbiguousLock.
//
// Clock-free rule. Before each PATCH the lock records (durably, see
// fileClaimLock) the exact fields of that PATCH and `expect`: the record
// values that prove it was applied, including the claim id (`Claimed By` =
// owner plus the unique `Claimed At` of this claim). A PATCH is applied at
// most once, so once the record shows `expect`, no write of that claimer is
// still pending: the claim is the claimer's, and the lock can go. While the
// record does not show `expect`, the PATCH outcome is unknown and the lock
// stays. No clock, server Date header or waiting period is involved, so clock
// jumps and stale, invalid or backward Date headers cannot open the clear.
//
// The only exception is the documented operator override
// `clear-ambiguous <item> --force-accept-risk` (Gate 8 is synthetic): it
// removes the lock with an explicit warning that a late write could
// overwrite a later claimer. Safety without the override assumes no timing.

const clearCommand = item => `node gate8-queue.mjs clear-ambiguous ${item ?? '<item>'}`;
const operatorAction = item => `Do not delete the lock file: a timed-out PATCH can still land. Run \`${clearCommand(item)}\`; it clears the lock only once the Queue record shows the recorded PATCH values (then that PATCH has applied and nothing is pending), and otherwise refuses and explains the options.`;
const pidAlive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// Equal field value; ISO datetimes are compared by instant (Airtable may
// normalize the string form). Anything else must be identical.
const isoLike = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v);
const sameValue = (a, b) => a === b || (isoLike(a) && isoLike(b) && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
export const recordShows = (fields, expect) => !!expect && typeof expect === 'object' && Object.keys(expect).length > 0
 && Object.entries(expect).every(([k, v]) => sameValue(fields?.[k], v));

// clearAmbiguousLock({lock, item, get, forceAcceptRisk}): clear a claim lock
// left by an ambiguous PATCH (state 'ambiguous') or by a dead claimer.
//  1. Refuse a wrong item, and a lock whose holder still runs (unless its
//     state is 'ambiguous': that claimer has already returned).
//  2. A current-format lock still in state 'claiming' never recorded a PATCH;
//     the record is fsynced before any PATCH is sent, so none was sent: the
//     lock is removed (outcome 'no-patch-sent').
//  3. Otherwise read the record once. If it shows the lock's `expect` values,
//     the recorded PATCH has applied: report the claim as the holder's
//     (outcome 'patch-applied') and remove the lock, as the normal post-claim
//     flow does.
//  4. If it does not (or the lock is a legacy format without recorded PATCH
//     values), refuse and keep the lock: the PATCH may still apply.
//     With forceAcceptRisk the lock is removed anyway and `warn` logs an
//     explicit warning (action 'force-cleared').
// Clears are serialized by a second O_EXCL file `<lock>.clear`, and the lock
// must still have the content inspected in step 1.
export async function clearAmbiguousLock({ lock, item, get, forceAcceptRisk = false, isAlive = pidAlive, warn = m => console.error(m) }) {
 const refused = (reason, extra = {}) => ({ action: 'refused', reason, lockPath: lock.path, ...extra });
 const raw = () => { try { return fs.readFileSync(lock.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
 const mutex = `${lock.path}.clear`;
 try { fs.writeFileSync(mutex, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); }
 catch (e) { if (e.code === 'EEXIST') return refused('clear-in-progress', { message: `Another clear holds ${mutex}; if no clear is running, that file may be removed (it guards only clears, never claims).` }); throw e; }
 try {
  const seen = raw();
  if (seen === null) return { action: 'no-lock', lockPath: lock.path };
  let h = null; try { h = JSON.parse(seen); } catch {}
  const who = h?.owner ?? 'the claimer';
  if (h?.item && item && h.item !== item) return refused('wrong-item', { holder: h, message: `The lock is for item ${h.item}, not ${item}.` });
  if (h && h.state !== 'ambiguous' && isAlive(h.pid)) return refused('claimer-running', { holder: h, message: `Claimer pid ${h.pid} is still running; wait for it to finish.` });
  const remove = () => { if (raw() !== seen) return false; fs.rmSync(lock.path); return true; };
  const lockChanged = () => refused('lock-changed', { message: 'The lock changed during the clear; nothing removed.' });
  const current = h?.format === LOCK_FORMAT;
  if (current && h.state === 'claiming') {
   if (!remove()) return lockChanged();
   return { action: 'cleared', outcome: 'no-patch-sent', lockPath: lock.path, holder: h,
    message: `${who} recorded no PATCH, and every PATCH is recorded durably before it is sent, so none was sent. Lock cleared.` };
  }
  const hasExpect = current && h.expect && typeof h.expect === 'object' && Object.keys(h.expect).length > 0;
  let record = null, readError = null;
  if (hasExpect) {
   try { record = await get(); } catch (e) { if (!forceAcceptRisk) throw e; readError = String(e?.message ?? e); }
   if (record && recordShows(record.fields, h.expect)) {
    if (!remove()) return lockChanged();
    const f = record.fields ?? {};
    return { action: 'cleared', outcome: 'patch-applied', owner: h.owner, lockPath: lock.path, holder: h, record: { Status: f.Status ?? null, 'Claimed By': f['Claimed By'] || null },
     message: `${who}'s ${h.step ?? 'claim'} PATCH has applied: the record shows its recorded values (Status ${f.Status}, Claimed By ${f['Claimed By']}), so no write of ${who} is pending. The claim is ${who}'s; lock cleared as after a completed claim. ${who}'s process has ended, so review or reset the item.` };
   }
  }
  const reason = hasExpect ? 'patch-outcome-unknown' : 'legacy-lock';
  const why = hasExpect
   ? `The record does not show ${who}'s recorded ${h.step ?? ''} PATCH values ${JSON.stringify(h.expect)}, so that PATCH's outcome is unknown: it may still apply.`
   : 'The lock records no PATCH values (it is unreadable or was written by an older claim.mjs), so whether a PATCH is still pending cannot be decided.';
  if (!forceAcceptRisk) return refused(reason, { holder: h, record: record?.fields,
   message: `${why} The lock is kept. Safe options: wait and rerun \`${clearCommand(item ?? h?.item)}\` later (it clears as soon as the record shows those values), or run \`${clearCommand(item ?? h?.item)} --force-accept-risk\`, which removes the lock and accepts that a late write could overwrite a later claimer.` });
  const warning = `WARNING: --force-accept-risk: ${why} The claim lock ${lock.path} is being removed anyway. If that PATCH applies later it can overwrite a later claimer's ownership (two owners). Check the record before the next claim.`;
  warn(warning);
  if (!remove()) return lockChanged();
  return { action: 'force-cleared', reason, lockPath: lock.path, holder: h, warning, ...(readError ? { readError } : {}), record: record?.fields ?? null };
 } finally { fs.rmSync(mutex, { force: true }); }
}

// get(): current record; patch(fields): PATCH the record; save(owner):
// persist local ownership. Returns {action:'claimed'} only while holding the
// lock. The lock is released only when no claim PATCH can still land: after
// the claim completes, after a skip/read failure, or after a definite (4xx)
// PATCH failure. An ambiguous PATCH result keeps the lock, marks it
// "ambiguous" and returns action 'needs-operator'. A lock left by a crash or
// an ambiguous PATCH makes later claims skip (fail closed) until an operator
// runs clearAmbiguousLock (`gate8-queue.mjs clear-ambiguous <item>`); nothing
// removes it automatically.
// Before each PATCH the lock durably records {state:'patching', step, patch:
// the exact fields sent, expect: the record values that prove it applied}.
// The claim id is this claim's `Claimed At` value, so `expect` is unique to
// this claim: owner step {Claimed By, Claimed At}; Doing step {Status:'Doing',
// Claimed By, Claimed At}.
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
 const guardedPatch = async (fields, step, expect) => {
  // Record (and fsync) this PATCH's exact fields and expected record values
  // BEFORE sending it. If that fails, nothing is sent and the lock is
  // released normally.
  lock.mark?.({ state: 'patching', step, patch: fields, expect, patchStartedAt: stamp() });
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
  // Whole seconds, so the value survives any sub-second normalization by the
  // store and still compares equal in clearAmbiguousLock.
  const claim = { 'Claimed By': owner, 'Claimed At': new Date(Math.floor((lock.now ?? Date.now)() / 1000) * 1000).toISOString() };
  await guardedPatch(claim, 'owner', { ...claim });
  const rb = await get();
  if (rb.fields['Claimed By'] !== owner) throw Error('Claim readback mismatch');
  await guardedPatch({ Status: 'Doing' }, 'doing', { Status: 'Doing', ...claim });
  save(owner);
  return { action: 'claimed', owner };
 } catch (e) {
  if (!e?.ambiguous) throw e;
  return { action: 'needs-operator', reason: 'ambiguous-patch', lockPath: lock.path, error: e.message,
   clearCommand: clearCommand(item), message: `A claim PATCH may still be applied; the claim lock ${lock.path} is kept. ${operatorAction(item)}` };
 } finally { if (!keep) lock.release(); }
}
