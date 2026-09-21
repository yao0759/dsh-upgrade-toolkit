# Issue 02 — `first frame is not exactly one header`

## Symptom
```
corrupt Zstandard session log: first frame is not exactly one header line
dsh: warning: N entries did not activate
session-controller: pending (waiting for service: workspaceRegistry)
```

## Root cause
`session.jsonl.zstd` uses multi-frame framing:
- Frame 1 independently decodes to the single session-header JSON line.
- Frames 2+ stream the events, checksummed.

Recompressing the entire file with a normal `zstd` CLI / `zstandard` Python
library merges multiple lines into frame 1, which the Host rejects. During
startup the workspace registry lists stored headers; one bad frame aborts that
init and the downstream services stay pending — the model tab looks stuck.

## Fix
Rebuild framing explicitly:
```js
const z = require('node:zlib')
const head = z.zstdCompressSync(headerLine + '\n',
  { level: 3, params: { [z.constants.ZSTD_c_checksumFlag]: 1 } })
const body = z.zstdCompressSync(restBytes,
  { level: 3, params: { [z.constants.ZSTD_c_checksumFlag]: 1 } })
Buffer.concat([head, body])
```
`scripts/migrate-sessions.mjs` automates this and validates via `zstd -t`.

## What NOT to do
- Do not run `zstd -o session.jsonl.zstd <plaintext>` over the whole file.
- Do not use `zstandard.ZstdCompressor().compress(...)` from Python without
  reconstructing the header-only first frame.
