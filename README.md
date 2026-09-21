# DSH Upgrade Toolkit

A practical, runnable toolkit for recovering a **DeepSeek Harness (DSH)**
installation after a version upgrade — documented from a real 0.1.5 →
0.1.6-alpha migration where 220 of 261 stored sessions and three plugins broke.

If you upgraded DSH and now see any of these, this repo is for you:

- `... refuses this format v0 Session: source summary requires notice form`
- `corrupt Zstandard session log: first frame is not exactly one header`
- `failed to create session: TypeError: session.events is not iterable`
- Old conversations fail to load / the model tab is stuck on "loading"
- A plugin "did not activate" after the upgrade

## Why these happen

A DSH version jump can change both the **session file format** and the **Host
plugin APIs**, with no compatibility promise across pre-stable releases.
There are two independent failure surfaces:

1. **Session payload + framing.** The format validator got stricter (a plugin
   source needs `form: "notice"` to carry a `summary`), and `session.jsonl.zstd`
   is a *multi-frame* file whose first frame must independently decode to just
   the header line. Fixing the payload with an ordinary `zstd` recompress
   destroys that framing and cascades into a workspace-registry failure.

2. **Plugin/Host API drift.** Plugins call Host interfaces that changed
   (`session.events` → `session.snapshotEvents()`, Connection RPC grants, the
   Mnemon settings RPC). Older plugin releases stop activating until upgraded.

A single bad session can make the whole workspace registry fail, which is why
"just one conversation" errors often coincide with the model never loading.

## Quick start

Requires **Node.js ≥ 22** (zstd support is built into `node:zlib`) and the
`zstd` CLI on your PATH.

```bash
# 1. Scan only — nothing is changed (always do this first)
node scripts/migrate-sessions.mjs

# 2. Apply the repair (backs up every file automatically)
node scripts/migrate-sessions.mjs --apply

# 3. Restart DSH
systemctl --user restart deepseek-harness.service
```

Custom sessions location:

```bash
node scripts/migrate-sessions.mjs --root /path/to/.dsh/sessions --apply
```

Every modified file gets a one-time `.predsmfix.bak` next to it. The tool
decompresses, removes only invalid display-only `summary` fields, rebuilds the
exact multi-frame Zstandard layout, validates with `zstd -t`, and only then
replaces the file atomically.

## Plugin compatibility matrix

After the 0.1.6-alpha jump these plugins had to move together with the Host:

| Plugin | Old → New | Failure |
|---|---|---|
| `dsh-pocket` | 2.10.0 → 2.10.6 | Connection RPC / missing `webServer` inject |
| `dsh-mnemon` | 0.4.4 → 0.5.12 | Settings RPC + `remoteAccess` grant |
| `@anionex/dsh-vision-toolkit` | 0.1.40 → 0.1.45 | `session.events is not iterable` |

Full symptoms, fixes, and config snippets are in
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Repository layout

```
scripts/migrate-sessions.mjs   # the main runnable repair tool
docs/
  TROUBLESHOOTING.md           # every issue, symptom, root cause and fix
  issues/                      # one file per encountered failure
  config/                      # reference config snippets
```

## Safety

- Dry-run by default; `--apply` is explicit.
- Automatic backups before any write.
- Validation (`zstd -t`) gates every replacement.
- Only a redundant metadata field is removed; instructions and recall content
  are byte-for-byte preserved.
- No network calls; runs entirely locally.

## Notes on scope

- Developed against the 0.1.5 → 0.1.6-alpha upgrade. The same mechanisms
  (format validation + multi-frame zstd + plugin API drift) apply to later
  jumps, but always run the dry scan first and back up.
- This is a community recovery toolkit, not an official DeepSeek project.
