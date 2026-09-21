# Issue 06 — tool calls fail: `Cannot read properties of undefined (reading 'prepare')`

> Encountered on `0.1.6-alpha.2`. Normal chat works; **any tool call**
> (Grep, Bash `ls`, reading a file) fails with this error.
> Fix verified end-to-end (5 consecutive tool calls succeeded).

## Symptom

```
Cannot read properties of undefined (reading 'prepare')
at startCall (packages/core/agent-loop/lib/index.js:586)
...
本轮运行失败  UNKNOWN
```

The failing line:

```js
const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)
```

It is **not** the tool (Grep/Bash) or the target file that is broken — the
scheduler cannot be resolved.

## What is NOT the cause (all ruled out with evidence)

- The tool itself / the file being read.
- Missing `dsh-tools` install; every workspace symlink resolves to the same dir.
- Multiple physical copies of `dsh-tools` (resolve paths compared — identical).
- `npm ls` showing `invalid: "workspace:^"` — that is npm misreading pnpm links.
- A stale Node process.

## Root cause

DSH runs via `node --import tsx/esm apps/cli/src/bin.ts web`. The process mixes:

- **TypeScript source** (`src/*.ts`) via tsx, and
- the prebuilt **bundle** (`lib/index.js`) for agent-loop.

The scheduler key was a plain symbol:

```js
export const TOOL_RUNTIME_SCHEDULER = Symbol('@deepseek-ai/dsh-tools.scheduler')
```

A plain `Symbol()` is unique per creation:

```js
Symbol('x') !== Symbol('x')
```

So in one process:

```
ToolRuntime registers the scheduler with Symbol A (src)
agent-loop looks  up the scheduler with Symbol B (lib)
=> ctx.tools[TOOL_RUNTIME_SCHEDULER] is undefined
=> .prepare() throws
```

## Fix — share one global symbol

Back up, then switch to `Symbol.for(...)`, which returns the same symbol from
the process-wide registry:

```js
export const TOOL_RUNTIME_SCHEDULER =
  Symbol.for('@deepseek-ai/dsh-tools.scheduler')
```

```bash
cp -a packages/core/tools/src/index.ts packages/core/tools/src/index.ts.bak
# edit Symbol(...) -> Symbol.for(...) in packages/core/tools/src/index.ts
pnpm run build:lib:host      # regenerates lib; bundle now uses Symbol.for
```

Verify src and lib resolve to the same symbol:

```bash
node --import tsx/esm --input-type=module -e "
const src = await import('./packages/core/tools/src/index.ts');
const lib = await import('./packages/core/tools/lib/index.js');
console.log('same:', src.TOOL_RUNTIME_SCHEDULER === lib.TOOL_RUNTIME_SCHEDULER);
"
# same: true
```

Then restart DSH and use the **new** token URL printed on startup (the old
token is invalidated).

## End-to-end confirmation

After the fix, a turn that invokes multiple tools (`Grep`, `Bash ls`) completed
with **5 tool calls** and no `prepare` error. Note that tool *outputs* can still
show expected sandbox/permission behavior (ripgrep denied on root-private
`/tmp/systemd-private-*` dirs; Bash runs in a mount-namespaced empty `/tmp`) —
those are not scheduler failures.

## Generic lesson

Any cross-plane key that must match between tsx-loaded **src** and prebuilt
**lib** has to be a stable, registry-global value (`Symbol.for`, a string, or a
shared constant) — never a freshly created `Symbol()`.
