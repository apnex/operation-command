# operation-command

Run one declared invocation from a command line, reporting its ending through the exit status.

**Status: built, and certified at zorg's Delta 1, stage 4c, at `9612b36`.**\
Its vision is ratified (zorg's `D44`), and its contract's design is certified at zorg's Delta 1, amendment 2.\
Its contract tests run a fixture application's commands as child processes, with real signals, for `declared-command-dispatch`, `ending-exit-status`, `repeat-command-line` and `command-call-bound`, and run them through operation-call over AGP's production in-process carrier; `command-reference` is left out of Delta 1 (zorg's `D37`).

- `VISION.md` - why it exists, and what it will never be.
- `CONTRACT.md` - what a consumer can depend on, one capability per row.
- `docs/DECISIONS.md` - the rulings about this component.

It belongs to a component set first composed by zorg (`apnex/zorg`), and is private until its first working code.

It depends on operation-call through a `file:` link to a checkout beside it, and its integrated tests link AGP's `@agp/core`, `@agp/node` and `@agp/transport-loopback` from an AGP checkout at `f16266a` the same way; each must be installed and built first, since neither commits its `dist/`.

To run the tests from clean checkouts:
```sh
(cd ../agp && git checkout f16266a && npm ci --offline && npm run build)
(cd ../shape-check && npm ci --offline && npm run build)
(cd ../operation-call && npm ci --offline && npm run build)
npm ci --offline
npm test
```
