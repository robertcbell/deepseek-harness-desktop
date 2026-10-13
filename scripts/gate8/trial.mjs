import { setTimeout as sleep } from 'node:timers/promises';
import { confirmReady, createFreshClaimGate } from './ready-handoff.mjs';
import { createCompletionDeadline } from './deadline.mjs';

// Dependencies keep tests portable: no browser, journal, credentials or live queue.
export async function runTrial({ recordId, expectedReport }, deps, timing = {}) {
  const { killDelayMs = 90000, pollMs = 10000, completionMs = 300000,
    claimMs = 70 * 60000, restartMs = 30000, recoveryMs = 60000 } = timing;
  const controller = new AbortController();
  const delay = ms => sleep(ms, undefined, { signal: controller.signal });
  const deadline = createCompletionDeadline(completionMs);
  const start = Date.now();
  const result = { status: 'failed', start: new Date(start).toISOString(), claimTime: null,
    kill: null, recovered: null, completionTime: null, report: null };
  let fault, faultError;
  const emit = event => deps.emit?.(event);
  const read = async () => {
    const record = await deps.readRecord(recordId);
    if (record.id !== recordId) throw new Error('Record scope mismatch');
    return record;
  };
  try {
    if (await deps.reportInfo(expectedReport)) throw new Error('Expected report already exists');
    const readyProof = await confirmReady({ recordId, read });
    emit({ stage: 'ready-confirmed', ...readyProof });
    const gate = createFreshClaimGate(readyProof);
    async function timedKill() {
      await delay(killDelayMs);
      const target = await deps.listener();
      if (controller.signal.aborted) return;
      if (!target || !Number.isSafeInteger(target.pid) || target.pid <= 1) throw new Error('No verified listener at timed kill');
      await deps.kill(target.pid, 'SIGKILL');
      const at = Date.now();
      result.kill = { at: new Date(at).toISOString(), pid: target.pid, signal: 'SIGKILL', delayAfterClaimMs: at - Date.parse(result.claimTime) };
      deadline.arm(at);
      emit({ stage: 'timed-sigkill', ...result.kill });
      const until = at + restartMs;
      let manuallyStarted = false;
      while (!controller.signal.aborted) {
        const next = await deps.listener();
        if (next && next.pid !== target.pid) {
          result.recovered = { at: new Date().toISOString(), pid: next.pid, manualStart: manuallyStarted };
          emit({ stage: 'service-recovered', ...result.recovered });
          return;
        }
        if (Date.now() >= until && !manuallyStarted) {
          await deps.startService();
          manuallyStarted = true;
        }
        if (Date.now() >= until + recoveryMs) throw new Error('Listener did not recover');
        await delay(Math.min(1000, pollMs));
      }
    }
    while (true) {
      deadline.check();
      if (faultError) throw faultError;
      const record = await deadline.race(read());
      const status = record.fields.Status;
      if (['Blocked', 'Dropped'].includes(status)) throw new Error('Fixture entered ' + status);
      if (!result.claimTime && gate.observe(status) === 'claim') {
        if (!record.fields['Claimed By']) throw new Error('Doing record has no claim owner');
        result.claimTime = new Date().toISOString();
        emit({ stage: 'claim-observed', at: result.claimTime });
        fault = timedKill().catch(error => { faultError = error; });
      }
      if (status === 'Done' && !result.kill) throw new Error('Done before required timed kill');
      if (status === 'Done' && result.recovered) {
        const report = await deadline.race(deps.reportInfo(expectedReport));
        if (report && report.mtimeMs >= start && report.size > 0) {
          result.status = 'passed';
          result.completionTime = new Date().toISOString();
          result.report = expectedReport;
          emit({ stage: 'trial-passed', ...result });
          return result;
        }
      }
      if (!result.claimTime && Date.now() - start >= claimMs) throw new Error('Scheduler claim timeout');
      await deadline.race(delay(pollMs));
    }
  } catch (error) {
    result.reason = error.message;
    emit({ stage: 'trial-stopped', ...result });
    return result;
  } finally {
    controller.abort();
    deadline.dispose();
    // A rejected timer is handled by fault.catch; never leave a later kill armed.
    if (fault) void fault;
  }
}
