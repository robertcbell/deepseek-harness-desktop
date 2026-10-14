# Reproducing Gate 8 tooling

Use Node 24 or later, npm, Git, and tar. The desktop app's existing runtime requirement is unchanged; these optional recovery tools require Node 24.

```sh
npm run test:gate8
npm run test:maestro
```

The first command uses synthetic records/process adapters and a loopback HTTP server. The second downloads the exact Maestro 0.9.0 tarball into a temporary directory, verifies its pinned SHA-512, applies the patch twice to prove idempotence, rejects another version, and tests synthetic v4 events. It never installs a plugin into a DSH profile or contacts Airtable.

## Applying the patch to an existing installation

```sh
bash scripts/apply-maestro-patch.sh /absolute/path/to/installed/maestro-package
```

This checks package name/version and the complete diff before applying it; repeated execution reports `already-applied`. It neither installs a plugin nor restarts DSH. Reapply after an update/reinstall, or register `patches/maestro-v4-0.9.0.patch` through your profile's existing pnpm patchedDependencies workflow. No automatic package lifecycle hook changes the running profile.

The diff is derived from the MIT-licensed [Maestro project](https://github.com/ddtcorex/dsh-maestro-supervisor); see [third-party notice](../patches/NOTICE.md).

## Optional live trial

Do not run this merely to execute the portable tests. Prepare a **fresh**, explicitly authorized synthetic fixture as Ready, a working native scheduler, one resume engine, launchd restart, idle sleep disabled, and externally supplied credentials. Leave prior Blocked evidence intact. The runner does not create/reset fixtures or configure a queue, preset, skill, model, power setting, or plugin.

Create a JSON config outside Git with these keys. The runner resolves symlinks and refuses config, report or evidence paths inside any Git checkout:

| Key | Meaning |
|---|---|
| `baseId`, `tableId`, `recordId` | Explicit Airtable scope; no searching other records |
| `expectedReport` | Absolute fresh `po-match-*.md` report path used by the worker |
| `outputDir` | Absolute fresh local evidence directory, outside Git |
| `dshEntry` | Absolute DSH entrypoint string visible in `ps` for this listener |
| `dshBin` | Absolute DSH executable for the normal-start fallback |
| `profile` | Existing DSH profile; defaults to `web` |
| `port` | Existing listener port; defaults to `3080` |

Supply `AIRTABLE_TOKEN` through your own environment mechanism. Never put its value in the config or command history. Other restart environment values must also be provided by the caller; the runner never reads private files or Keychain.

```sh
node scripts/run-gate8-trials.mjs --config /absolute/path/outside/git/trial.json
# Explicit opt-in to one live, PID-targeted fault injection:
node scripts/run-gate8-trials.mjs --config /absolute/path/outside/git/trial.json --arm
```

The first command validates paths/config only. The armed run observes confirmed Ready → Doing, waits 90 seconds, kills exactly one verified listener, waits for automatic restart, and uses normal DSH startup only if no listener returns within 30 seconds. It polls Airtable and the expected new report every 10 seconds, stopping at five minutes after kill. A failed run writes its result and freezes only the explicitly configured fixture as Blocked; it never retries a PATCH or repairs/rearms the worker. Review ambiguous freeze responses manually.

Run a separate fresh scope per trial. Resume attribution and semantic worker repair/correction counts must be audited after the result; they are not completion gates. Raw local evidence must remain outside Git. The packaged runner preserves the decision rules but was not itself subjected to another live kill test during closeout.

## Publishing changes and documentation

Commit reusable implementation under `scripts/`, portable tests under `tests/`, the version-pinned patch and its notices under `patches/`, and documentation under `docs/`. Keep the results summary in [gate8-results.md](gate8-results.md) explicit about synthetic data, failed attempts, and what was not tested. Documentation belongs in Git; raw trial evidence does not.

The root-level setup and diagnostic helpers are local orchestration history, not the packaged runner. Their ignore rules do not exclude the portable implementations under `scripts/gate8/` or public documentation under `docs/`. Keep machine-specific skill copies and their generated reports private. If a local helper contains a reusable fix, adapt it into the portable implementation and add a focused test rather than committing the helper unchanged.

Keep credentials, runtime configuration, raw session journals, Queue snapshots and identifiers, screenshots, and generated trial reports outside Git. The live runner enforces this boundary for its configuration, expected report and output directory, including symlinks. Public docs should use placeholders for private identifiers and paths; preserve exact raw evidence separately for authorized local review. Ignore rules do not sanitize files that are already tracked.

Before committing, inspect the actual staged diff and file list. Stage the intended paths explicitly; avoid a blanket add of the trial workspace. Run both portable test commands above, then wait for the PR's Linux/macOS recovery tests and macOS app-build check. A green portable suite does not replace a live interruption trial, and a successful synthetic trial does not establish reboot, laptop pairing, or production readiness.

After merging, fetch the publication remote and fast-forward the corresponding local branch. A checkout tracking a different remote or an older commit can still look incomplete after its PR has merged; confirm the PR's merged state and the publication branch independently of local trial files.
