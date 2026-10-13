import test from 'node:test';
import assert from 'node:assert/strict';
import { runTrial } from '../../scripts/gate8/trial.mjs';
import { createCompletionDeadline } from '../../scripts/gate8/deadline.mjs';
import { findListener } from '../../scripts/gate8/listener.mjs';
const scope = { recordId: 'fixture-record', expectedReport: '/synthetic/po-match-test.md' };
const row = status => ({ id: scope.recordId, fields: { Status: status, 'Claimed By': status === 'Doing' ? 'synthetic-owner' : null } });
const timing = { killDelayMs: 30, pollMs: 5, completionMs: 100, claimMs: 100, restartMs: 20, recoveryMs: 20 };
function fake() {
  let reads = 0, killed = false, recovered = false;
  const events = [], kills = [];
  return {
    events, kills,
    deps: {
      readRecord: async () => row(++reads === 1 ? 'Ready' : recovered ? 'Done' : 'Doing'),
      reportInfo: async () => recovered ? { mtimeMs: Date.now(), size: 10 } : null,
      listener: async () => { if (killed) { recovered = true; return { pid: 200 }; } return { pid: 100 }; },
      kill: async (pid, signal) => { kills.push({ pid, signal, at: Date.now() }); killed = true; },
      startService: async () => assert.fail('Automatic recovery should not start a second server'),
      emit: event => events.push(event),
    },
  };
}
test('Ready proof precedes claim; timed kill targets one PID; completion requires Done and report', async () => {
  const f = fake(); const result = await runTrial(scope, f.deps, timing);
  assert.equal(result.status, 'passed');
  assert.deepEqual(f.kills.map(({ pid, signal }) => ({ pid, signal })), [{ pid: 100, signal: 'SIGKILL' }]);
  assert.ok(result.kill.delayAfterClaimMs >= timing.killDelayMs);
  assert.equal(result.recovered.manualStart, false);
  assert.equal(result.report, scope.expectedReport);
  assert.deepEqual(f.events.map(e => e.stage), ['ready-confirmed', 'claim-observed', 'timed-sigkill', 'service-recovered', 'trial-passed']);
});
test('Done before kill cancels the pending kill rather than producing a false pass', async () => {
  const f = fake(); let reads = 0;
  f.deps.readRecord = async () => row(++reads === 1 ? 'Ready' : reads === 2 ? 'Doing' : 'Done');
  const result = await runTrial(scope, f.deps, timing);
  assert.equal(result.status, 'failed'); assert.match(result.reason, /before required timed kill/);
  await new Promise(r => setTimeout(r, 50)); assert.equal(f.kills.length, 0);
});
test('a report without Done cannot pass and the deadline interrupts a hung GET', async () => {
  const f = fake(); let reads = 0;
  f.deps.readRecord = async () => ++reads === 1 ? row('Ready') : reads === 2 ? row('Doing') : new Promise(() => {});
  const start = Date.now(); const result = await runTrial(scope, f.deps, { ...timing, completionMs: 40 });
  assert.equal(result.status, 'failed'); assert.match(result.reason, /five minutes/);
  assert.ok(Date.now() - start < 1000); assert.equal(f.kills.length, 1);
});
test('Done without a fresh report fails at the completion deadline', async () => {
  const f = fake(); f.deps.reportInfo = async () => null;
  const result = await runTrial(scope, f.deps, { ...timing, completionMs: 40 });
  assert.equal(result.status, 'failed'); assert.equal(result.report, null);
});
test('expired deadline rejects a late Done read', async () => {
  const d = createCompletionDeadline(1); d.arm(Date.now() - 20);
  await assert.rejects(d.race(Promise.resolve(row('Done'))), /five minutes/); d.dispose();
});
test('listener lookup bounds lsof to candidates and rejects a changed or ambiguous PID', () => {
  const commands = [];
  const exec = (bin, args) => {
    commands.push({ bin, args });
    if (args.includes('-axo')) return '100 /usr/bin/node /opt/dsh/bin.js web --port 3080 --no-open\n101 /usr/bin/node /opt/other/bin.js web --port 3081';
    if (bin.endsWith('/lsof')) return '100\n';
    return '/usr/bin/node /opt/dsh/bin.js web --port 3080 --no-open';
  };
  assert.equal(findListener({ entry: '/opt/dsh/bin.js', exec }).pid, 100);
  assert.deepEqual(commands[1].args, ['-nP', '-a', '-p', '100', '-iTCP:3080', '-sTCP:LISTEN', '-t']);
  assert.throws(() => findListener({ entry: '/opt/dsh/bin.js', exec: (bin, args) => bin.endsWith('/lsof') ? '100\n200\n' : exec(bin, args) }), /Exactly one/);
  assert.throws(() => findListener({ entry: '/opt/dsh/bin.js', exec: (bin, args) => args.includes('-o') ? '/unrelated/process' : exec(bin, args) }), /changed/);
});

test('private paths reject Git evidence directories and symlink aliases', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { requireOutsideGit } = await import('../../scripts/gate8/private-paths.mjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate8-paths-'));
  try {
    const repo = path.join(temp, 'repo'); fs.mkdirSync(repo); execFileSync('git', ['init', '-q', repo]);
    fs.symlinkSync(repo, path.join(temp, 'alias'));
    assert.throws(() => requireOutsideGit(path.join(repo, 'evidence', 'result.json')), /outside Git/);
    assert.throws(() => requireOutsideGit(path.join(temp, 'alias', 'evidence')), /outside Git/);
    assert.equal(requireOutsideGit(path.join(temp, 'private', 'result.json')), path.join(fs.realpathSync(temp), 'private', 'result.json'));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
