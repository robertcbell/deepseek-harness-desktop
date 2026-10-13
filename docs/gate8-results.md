# Gate 8: synthetic interruption recovery

On October 13, 2026, three executed recovery trials completed a synthetic PO/invoice comparison after a deliberate SIGKILL, using DSH 0.2.0-rc.2 and patched Maestro 0.9.0. Each reached Airtable Done and produced its expected new report without manual recovery intervention.

| Executed recovery trial | Listener restart | Maestro resume after kill | Done + report after kill | Worker repairs | Corrective command changes |
|---|---:|---:|---:|---:|---:|
| 1 | 1.146s | 8.879s | 120.316s | 0 | 0 |
| 2 | 1.136s | 8.947s | 89.710s | 0 | 0 |
| 3 | 1.134s | 8.895s | 69.867s | 0 | 0 |

These are three successful **executed interruption trials**, not three consecutive operator attempts on an unchanged fixture. Earlier setup failures and a pre-kill listener-lookup abort were preserved locally; replacement trials used fresh fixture scopes. Raw logs, record/session identifiers, and configuration snapshots are deliberately excluded from this repository.

Repairs mean worker error fixes; corrections mean changed commands made to correct an error. Automatic recovery is neither. Trial 1's nonzero discovery probe was first-attempt exploration of the Jev shadow-mode contract after report verification passed, not a corrected retry.

## Durable fixes

- Maestro recognizes v4 journals, decodes concatenated Zstd frames using Node 24, preserves complete prefixes when the final frame/JSON line is incomplete, and accepts both direct and wrapped DSH Agent controller results.
- Kill decisions use elapsed time: 90 seconds after Airtable Doing. Only a verified DSH listener PID receives SIGKILL.
- Runner confirms Ready before observing a fresh Doing claim; stale Done/Doing does not satisfy the handoff gate.
- Completion uses only Airtable and a fresh expected report, with an independent five-minute deadline. GET retries are bounded; writes are not retried after ambiguous responses.
- Listener discovery scopes lsof to DSH process candidates to avoid the slow global macOS scan.
- OS idle sleep was disabled separately, preventing a host restart from dropping a plugin's keep-awake assertion. The repository does not alter power settings.

## Scope and limits

This is synthetic fixture evidence, **not a real business outcome**. Real PO pairs, live business data, multi-day stability, and MacBook pairing under load were not tested. The 90-second window was calibrated for this task. The patch is for Maestro 0.9.0 with DSH 0.2.0-rc.2 and requires Node 24's native Zstd decoder. Updates require compatibility testing and reapplying or registering the patch with the package manager.

Portable tests validate the patch against a pinned upstream package and exercise the operator with synthetic adapters. A live repeat additionally needs an authorized fresh fixture, the existing scheduler/worker, report conventions, launchd recovery, and one enabled resume engine; the tests do not create or alter those services.
