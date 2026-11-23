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
export function fileClaimLock(lockPath) {
 let seq = 0;
 const tmpName = () => `${lockPath}.tmp-${process.pid}-${++seq}-${Math.random().toString(36).slice(2)}`;
 const writeTemp = data => {
  const tmp = tmpName();
  try { fs.writeFileSync(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return tmp;
 };
 return {
  path: lockPath,
  acquire(owner) {
   const tmp = writeTemp({ owner, pid: process.pid, at: new Date().toISOString(), state: 'claiming' });
   try { fs.linkSync(tmp, lockPath); return true; }
   catch (e) { if (e.code === 'EEXIST') return false; throw e; }
   finally { fs.rmSync(tmp, { force: true }); }
  },
  // Rewrite the held lock's metadata (atomic rename over our own lock). The
  // lock stays held even if this fails.
  mark(fields) {
   const tmp = writeTemp({ ...(this.holder() ?? {}), ...fields, markedAt: new Date().toISOString() });
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

const operatorAction = lockPath => `If no claimer is running, review the Queue record (Claimed By, Status) and only then remove ${lockPath} manually.`;

// get(): current record; patch(fields): PATCH the record; save(owner): persist
// local ownership. Returns {action:'claimed'} only while holding the lock.
// The lock is released only when no claim PATCH can still land: after the
// claim completes, after a skip/read failure, or after a definite (4xx)
// PATCH failure. An ambiguous PATCH result keeps the lock, marks it
// "ambiguous" and returns action 'needs-operator'. A lock left by a crash or
// an ambiguous PATCH makes later claims skip (fail closed) until an operator
// removes it; nothing removes it automatically.
export async function claimItem({ owner, get, patch, save, lock }) {
 if (!lock.acquire(owner)) {
  const holder = lock.holder?.() ?? null;
  return { action: 'skip', reason: 'claim-lock-held', lockPath: lock.path, holder,
   message: `Claim lock ${lock.path} is held${holder?.state === 'ambiguous' ? ' after an ambiguous Queue PATCH' : ''} by ${holder?.owner ?? 'an unknown claimer'}. ${operatorAction(lock.path)}` };
 }
 let keep = false;
 const guardedPatch = async (fields, step) => {
  try { return await patch(fields); }
  catch (e) {
   if (definitePatchFailure(e)) throw e;
   keep = true;
   try { lock.mark?.({ state: 'ambiguous', step, error: String(e?.message ?? e) }); } catch {}
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
   message: `A claim PATCH may still be applied; the claim lock ${lock.path} is kept. ${operatorAction(lock.path)}` };
 } finally { if (!keep) lock.release(); }
}
