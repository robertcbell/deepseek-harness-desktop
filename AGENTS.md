# DeepSeek Harness Desktop

This macOS desktop source combines a Swift/WebKit shell in `app/`, a background
daemon in `daemon/`, the Bun CLI in `bin/`, and profile templates in `templates/`.
Read `README.md` and the documentation for the affected component before changes.

Use Bun as required by the README. `bun run build:app` compiles the macOS app
with the host Swift compiler and SDK; `bun run package:dmg` creates the package.
Available package checks are `bun run test:gate8` and `bun run test:maestro`;
inspect their setup before choosing a check for the changed component.

`setup`, `start`, `stop` and `restart` manage the installed environment and
launchd service; do not use them for an incidental documentation check.
Templates describe future configuration, not proof of the running profile.
Keep credentials, session logs and machine-specific operational evidence out
of this source repository. Preserve upstream provenance and license notices.
