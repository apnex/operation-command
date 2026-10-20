# operation-command

Run one declared invocation from a command line, reporting its ending through the exit status.

**Status: built, and certified at zorg's Delta 1, stage 4c, at `9612b36`, with amendment 8's URL-pattern and parser round-trip change at `c97c615`, and at zorg's Delta 4, stage 8 (`9ee0582`), which prints an answer's parts before its ending.**\
Its vision is ratified (zorg's `D44`) and amended (`D55`, `D64`), and its contract's design is certified at zorg's Delta 1, amendments 2 and 8 (`D56`), and Delta 4, stage 8 and amendment 8.\
Its contract tests run a fixture application's commands as child processes, with real signals, for `declared-command-dispatch`, `ending-exit-status`, `repeat-command-line` and `command-call-bound`, and run them through operation-call over AGP's production in-process carrier; a parts command's printing, its bound on unwritten output, its failed writes and its `resume` are tested in this process and through the process adapter; `command-reference` is built in zorg's Delta 3 (`D57`).

- `VISION.md` - why it exists, and what it will never be.
- `CONTRACT.md` - what a consumer can depend on, one capability per row.
- `docs/DECISIONS.md` - the rulings about this component.

It belongs to a component set first composed by zorg (`apnex/zorg`), and is private until its first working code.

It depends on operation-call through a `file:` link to a checkout beside it, and its integrated tests link AGP's `@agp/core`, `@agp/node` and `@agp/transport-loopback` from an AGP checkout at `baa2c1a` the same way; each must be installed and built first, since neither commits its `dist/`.

To run the tests from clean checkouts:
```sh
(cd ../agp && git checkout baa2c1a && npm ci --offline && npm run build)
(cd ../shape-check && npm ci --offline && npm run build)
(cd ../operation-call && npm ci --offline && npm run build)
npm ci --offline
npm test
```
