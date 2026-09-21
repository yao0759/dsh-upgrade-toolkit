# Troubleshooting Guide

Detailed root-cause analysis and fixes from a real DSH 0.1.5 → 0.1.6-alpha
upgrade. Issues are ordered roughly as they surfaced.

## Contents

1. [Session: `source summary requires notice form`](#1)
2. [Session: `first frame is not exactly one header`](#2)
3. [`session.events is not iterable`](#3)
4. [dsh-pocket: did not activate](#4)
5. [dsh-mnemon: settings RPC / memory panel](#5)
6. [Tool calls fail: `reading 'prepare'` (scheduler Symbol)](#6b)
7. [Workspace/mount prerequisites](#6)
8. [A debugging workflow that works](#7)

---

## 1. Session payload <a id="1"></a>

**Symptom**

```
failed to observe session "...": @deepseek-ai/dsh-session-format-v0-to-v1
refuses this format v0 Session: user/message 10 source summary requires
notice form
```

**Root cause.** The newer validator requires any plugin `source` that carries a
`summary` to use `form: "notice"`. Older DSH (notably the dsh-mnemon plugin)
wrote `form: "instructions"` or `form: "recall"` together with a `summary`
string. That combination is now rejected.

**Fix.** Delete the redundant `summary` field. For `instructions` and
`recall` forms the summary is a display-only title; the instructions body and
recall payload are unchanged. The migration script does this recursively.

This is normally a fleet-wide condition, not a single file — in our migration
220 of 261 sessions matched.

---

## 2. Multi-frame Zstandard layout <a id="2"></a>

**Symptom**

```
corrupt Zstandard session log: first frame is not exactly one header line
```

Often followed by:

```
dsh: warning: 4 entries did not activate
session-controller: pending (waiting for service: workspaceRegistry)
```

**Root cause.** `session.jsonl.zstd` is not a normal single-frame zstd file.
The first frame independently decodes to exactly the one session-header line so
the host can read the header without decoding the entire history; later
frames stream the events. If you "fix" the payload and then recompress the
whole file with the `zstd` CLI (or the `zstandard` Python library), the first
frame ends up containing many lines and the host rejects it.

When the workspace registry hits one such file while listing stored headers,
its init throws and everything downstream — session/workspace controllers and
the UI — stays pending. That is why the model tab appears stuck.

**Fix.** Rebuild the framing: frame 1 = compressed header line only, frames
2+ = compressed event stream, each checksummed. The script does this with
`node:zlib` and validates with `zstd -t` before replacing. Do not use plain
whole-file recompression.

---

## 3. `session.events is not iterable` <a id="3"></a>

**Symptom**

```
failed to create session "...": TypeError: session.events is not iterable
```

New sessions cannot be created; choosing a workspace or clicking "new session"
silently fails.

**Root cause.** The Host removed the iterable `session.events` property and
replaced it with a `session.snapshotEvents()` method. The vision toolkit's
`hasLoadedVisionSkill()` still iterated `session.events`, and this runs while
the session is attached — so every create attempt died before completing.

**Fix.** Upgrade `@anionex/dsh-vision-toolkit` from 0.1.40 to 0.1.45. The new
release uses `snapshotEvents()` with an `adapter.events ?? []` fallback.

```bash
# inside your profile dir (e.g. ~/.dsh/profiles/web), using the SAME pnpm
# content-addressed store your profile already uses
pnpm update @anionex/dsh-vision-toolkit@0.1.45
```

---

## 4. dsh-pocket did not activate <a id="4"></a>

**Symptom**

```
Error: cannot get property "webServer" without inject
DSH Host Connection RPC unavailable
dsh: warning: 1 entry did not activate
```

**Root cause.** A dependency-injection mismatch: the version of pocket did not
declare the injects the new Host scope required, so the plugin failed to mount
and the Connection RPC (needed by the settings/memory surface) was unavailable.

**Fix.** Upgrade pocket to the release matching the new Host
(2.10.0 → 2.10.6 for 0.1.6-alpha).

**pnpm store gotcha.** A profile's `node_modules` is linked from its own
content-addressed store. Running pnpm with the default global store raises
`ERR_PNPM_UNEXPECTED_STORE`. Point pnpm at the profile's store explicitly:

```bash
pnpm --store-dir ~/.dsh/.../<profile-store> update dsh-pocket@2.10.6
```

---

## 5. dsh-mnemon: settings RPC / memory panel <a id="5"></a>

**Symptom** — the in-browser memory settings panel fails to load with a
message asking whether the Host authorized the settings RPC.

**Two stacked causes:**

1. The plugin version predates the Host. Upgrade 0.4.4 → 0.5.12.
2. The settings/management RPC registers with `trusted-host` authority only
   when config `remoteAccess === "trusted-host"`; it defaults to `read-only`,
   so the browser deployment is not granted.

**Fix the grant** in your profile patch (deep-merge by id; do not edit
`node_modules`, it is overwritten on upgrade):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: mnemon
  config:
    remoteAccess: trusted-host
```

Restart and reopen with the **new** token printed in the log (the previous
token is invalidated).

---

## 6b. Tool calls fail: `reading 'prepare'` <a id="6b"></a>

**Symptom.** Normal chat replies; any tool (Grep, Bash `ls`, reading a file)
fails with `Cannot read properties of undefined (reading 'prepare')` at agent-loop
`startCall`. Full analysis and the runnable patch are in
[issues/06](issues/06-scheduler-symbol-for.md).

**Root cause.** The process mixes tsx **src** and prebuilt **lib**. The
scheduler key was a plain `Symbol()`, unique per plane, so the symbol used to
register differs from the one used to look up → `ctx.tools[scheduler]` is
undefined. Fix = `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`, rebuild
`build:lib:host`, verify src/lib symbols are equal, restart with the new token.

---

## Workspace / mount prerequisites <a id="6"></a>

Before blaming DSH, confirm the workspaces are reachable:

- Network shares (e.g. a CIFS mount at `/mnt/PublicShare`) must still be
  mounted and readable. `mount | grep PublicShare`.
- Local workspace directories must exist.

A session referencing a path that is no longer reachable can fail to observe.

---

## 7. Debugging workflow that works <a id="7"></a>

The most useful single technique when a request "does nothing":

1. **Capture the real error, including the stack trace.** Wrapped RPC errors
   usually carry only the message. Temporarily append `error.stack` to the
   error, reproduce, then revert.
2. **Edit what actually runs.** A `tsx` source entry can still resolve a
   package's compiled `lib`; check whether the string you're changing lives in
   `src` or `lib` and patch the file that is loaded.
3. **Hook `fetch` in the page** to see both the request endpoint and the
   returned body instead of assuming the click did nothing.
4. **Don't assume a clean/rebuild fixes an API mismatch.** A stack trace that
   names a specific plugin is the signal to upgrade that plugin, not to
   recompile.

Minimal in-page fetch capture:

```js
window.__r = []
const of = window.fetch
window.fetch = (...a) => of(...a).then(async r => {
  window.__r.push(await r.clone().text()); return r
})
// reproduce the failing action, then inspect window.__r
```
