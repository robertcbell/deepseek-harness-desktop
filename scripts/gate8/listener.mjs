import { execFileSync } from 'node:child_process';
// Restrict lsof to process candidates: a global macOS scan can block for ~50s.
export function findListener({ entry, port = 3080, exec = execFileSync }) {
  const listing = exec('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 2000 });
  const matches = command => command.includes(entry) && /(?:^|\s)web(?:\s|$)/.test(command)
    && new RegExp(`(?:^|\\s)--port(?:=|\\s+)${port}(?:\\s|$)`).test(command);
  const candidates = listing.split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    return m && matches(m[2]) ? [m[1]] : [];
  });
  if (!candidates.length) return null;
  let output;
  try {
    output = exec('/usr/sbin/lsof', ['-nP', '-a', '-p', candidates.join(','), `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 2000 });
  } catch (error) { if (error.status === 1) return null; throw error; }
  const pids = [...new Set(output.trim().split('\n').filter(Boolean))];
  if (pids.length !== 1 || !/^\d+$/.test(pids[0]) || !candidates.includes(pids[0])) {
    throw new Error('Exactly one verified DSH listener is required');
  }
  const pid = Number(pids[0]);
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid listener PID');
  const command = exec('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 2000 }).trim();
  if (!matches(command)) throw new Error('Listener command changed before verification');
  return { pid, command };
}
