import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Resolve symlinks even when the final output directory does not exist yet.
export function requireOutsideGit(input) {
  const missing = [];
  let existing = path.resolve(input);
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Cannot resolve private path');
    existing = parent;
  }
  const canonical = path.join(fs.realpathSync(existing), ...missing);
  const directory = fs.statSync(existing).isDirectory() ? fs.realpathSync(existing) : path.dirname(fs.realpathSync(existing));
  const probe = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 2000 });
  if (probe.error) throw new Error('Could not verify private path is outside Git');
  if (probe.status === 0) throw new Error('Config, report and evidence paths must remain outside Git');
  if (probe.status !== 128) throw new Error('Unexpected Git path check failure');
  return canonical;
}
