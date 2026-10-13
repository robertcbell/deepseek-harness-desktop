#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createAirtableApi } from './gate8/airtable-api.mjs';
import { findListener } from './gate8/listener.mjs';
import { requireOutsideGit } from './gate8/private-paths.mjs';
import { runTrial } from './gate8/trial.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/run-gate8-trials.mjs --config /path/outside/git/trial.json [--arm]\nWithout --arm: validate config only. Never creates fixtures or changes queue settings.');
} else {
  try {
    const configIndex = args.indexOf('--config');
    if (configIndex < 0 || !args[configIndex + 1]) throw new Error('--config is required');
    const configPath = requireOutsideGit(args[configIndex + 1]);
    const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    for (const k of ['baseId', 'tableId', 'recordId', 'expectedReport', 'outputDir', 'dshEntry', 'dshBin']) {
      if (typeof c[k] !== 'string' || !c[k].trim()) throw new Error('Missing config field: ' + k);
    }
    if (![c.baseId, c.tableId, c.recordId].every(id => /^[A-Za-z0-9_-]+$/.test(id))) throw new Error('Invalid Airtable identifiers');
    for (const k of ['expectedReport', 'outputDir', 'dshEntry', 'dshBin']) if (!path.isAbsolute(c[k])) throw new Error(k + ' must be absolute');
    if (!/^po-match-.*\.md$/.test(path.basename(c.expectedReport))) throw new Error('Expected report must match po-match-*.md');
    c.outputDir = requireOutsideGit(c.outputDir);
    c.expectedReport = requireOutsideGit(c.expectedReport);
    if (!fs.existsSync(c.dshEntry) || !fs.existsSync(c.dshBin)) throw new Error('DSH paths do not exist');
    const port = c.port ?? 3080;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
    if (!args.includes('--arm')) { console.log('Configuration valid; not armed.'); }
    else {
      if (!process.env.AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN must be supplied by the caller environment');
      if (fs.existsSync(c.expectedReport)) throw new Error('Expected report already exists');
      fs.mkdirSync(c.outputDir, { mode: 0o700, recursive: true });
      const resultFile = path.join(c.outputDir, 'result.json');
      const eventsFile = path.join(c.outputDir, 'observations.jsonl');
      if (fs.existsSync(resultFile) || fs.existsSync(eventsFile)) throw new Error('Output scope already used');
      const api = createAirtableApi({ base: `https://api.airtable.com/v0/${c.baseId}/${c.tableId}`, token: process.env.AIRTABLE_TOKEN });
      const result = await runTrial(c, {
        readRecord: id => api('GET', '/' + id),
        reportInfo: file => { try { const s = fs.statSync(file); return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
        listener: () => findListener({ entry: c.dshEntry, port }),
        kill: (pid, signal) => process.kill(pid, signal),
        startService: () => new Promise((resolve, reject) => {
          const fd = fs.openSync(path.join(c.outputDir, 'restart.log'), 'a', 0o600);
          const child = spawn(c.dshBin, ['--profile', c.profile ?? 'web', 'web', '--no-open', '--port', String(port)], { env: process.env, detached: true, stdio: ['ignore', fd, fd] });
          fs.closeSync(fd);
          child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
        }),
        emit: row => { fs.appendFileSync(eventsFile, JSON.stringify(row) + '\n', { mode: 0o600 }); console.log(JSON.stringify(row)); },
      });
      // Freeze only the explicit fixture on failure. No write is retried.
      if (result.status !== 'passed') {
        try { await api('PATCH', '/' + c.recordId, { fields: { Status: 'Blocked' } }); result.frozen = true; }
        catch { result.frozen = false; result.freezeError = 'Freeze failed or response ambiguous; inspect this fixture manually'; }
      }
      fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), { mode: 0o600 });
      // Exit even if an expired read/retry still has an open HTTP socket.
      process.exit(result.status === 'passed' ? 0 : 1);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
