import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { applyMaestroPatch } from './apply-maestro-patch.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-patch-test-'));
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '@ddtcorex/dsh-maestro-supervisor@0.9.0', '--ignore-scripts', '--json', '--pack-destination', temp, '--cache', path.join(temp, 'cache')], { encoding: 'utf8', timeout: 120000 }))[0];
  const archive = path.join(temp, packed.filename);
  const integrity = 'sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64');
  if (integrity !== 'sha512-xBbRhfCyYVVH053a6fjiDKIreoJTNC+FhvKJPym311WmFfoQL6bMzQnNRt+iOX/lWuDS4Gd8jA19JeCxoT5U+g==') throw new Error('Upstream package integrity changed');
  execFileSync('tar', ['-xzf', archive, '-C', temp]);
  const packageDir = path.join(temp, 'package');
  if (applyMaestroPatch(packageDir) !== 'applied') throw new Error('Fresh patch did not apply');
  if (applyMaestroPatch(packageDir) !== 'already-applied') throw new Error('Patch is not idempotent');
  const pkgFile = path.join(packageDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile));
  fs.writeFileSync(pkgFile, JSON.stringify({ ...pkg, version: '999.0.0' }));
  try { applyMaestroPatch(packageDir); throw new Error('Wrong version accepted'); } catch (e) { if (!/Only .* 0\.9\.0/.test(e.message)) throw e; }
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  execFileSync(process.execPath, ['--test', path.join(root, 'tests/maestro-v4.test.mjs')], { stdio: 'inherit', env: { ...process.env, MAESTRO_TEST_ROOT: packageDir } });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
