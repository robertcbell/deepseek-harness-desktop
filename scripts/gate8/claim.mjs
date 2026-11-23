import fs from 'node:fs';

// One Queue item has at most one owner.
//
// Airtable offers no conditional update (no If-Match/version check, no
// transaction): every PATCH is last-writer-wins, so GET-check-then-PATCH and a
// readback cannot exclude a second claimer. Exclusion therefore comes from a
// host-local lock taken with O_CREAT|O_EXCL ('wx'), held from the
// Ready/unclaimed check until the local owner is saved. It serializes every
// claimer on this host that uses the same lock path. It does NOT exclude
// claimers on another host or a human editing the record.
export function fileClaimLock(lockPath) {
 return {
  acquire(owner) {
   let fd;
   try { fd = fs.openSync(lockPath, 'wx', 0o600); }
   catch (e) { if (e.code === 'EEXIST') return false; throw e; }
   try { fs.writeSync(fd, JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() })); } finally { fs.closeSync(fd); }
   return true;
  },
  release() { fs.rmSync(lockPath, { force: true }); },
  holder() { try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { return null; } },
 };
}

// get(): current record; patch(fields): PATCH the record; save(owner): persist
// local ownership. Returns {action:'claimed'} only while holding the lock.
// A lock left by a crashed claimer makes later claims skip (fail closed) until
// an operator reviews the record and removes the lock file.
export async function claimItem({ owner, get, patch, save, lock }) {
 if (!lock.acquire(owner)) return { action: 'skip', reason: 'claim-lock-held', holder: lock.holder?.() ?? null };
 try {
  const r = await get();
  if (r.fields.Status !== 'Ready' || r.fields['Claimed By']) return { action: 'skip', status: r.fields.Status, claimed: !!r.fields['Claimed By'] };
  await patch({ 'Claimed By': owner, 'Claimed At': new Date().toISOString() });
  if ((await get()).fields['Claimed By'] !== owner) throw Error('Claim readback mismatch');
  await patch({ Status: 'Doing' });
  save(owner);
  return { action: 'claimed', owner };
 } finally { lock.release(); }
}
