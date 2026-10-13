import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export function applyMaestroPatch(packageDir) {
  const dir = fs.realpathSync(packageDir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.name !== '@ddtcorex/dsh-maestro-supervisor' || pkg.version !== '0.9.0') {
    throw new Error('Only @ddtcorex/dsh-maestro-supervisor 0.9.0 is supported');
  }
  const patchFile = fileURLToPath(new URL('../patches/maestro-v4-0.9.0.patch', import.meta.url));
  // git apply does not need a Git checkout. Checks cover both files before writing.
  const run = args => spawnSync('git', ['apply', ...args, patchFile], { cwd: dir, encoding: 'utf8' });
  if (run(['--reverse', '--check']).status === 0) return 'already-applied';
  if (run(['--check']).status !== 0) throw new Error('Package contents differ; refusing a partial or mismatched patch');
  if (run([]).status !== 0) throw new Error('Patch application failed');
  if (run(['--reverse', '--check']).status !== 0) throw new Error('Patch verification failed');
  return 'applied';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('One installed package directory is required');
    console.log(applyMaestroPatch(process.argv[2]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
