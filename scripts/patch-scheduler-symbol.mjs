#!/usr/bin/env node
/**
 * patch-scheduler-symbol.mjs
 * Detect/fix Issue 06: the scheduler key is a plain Symbol() which differs
 * between tsx-loaded src and prebuilt lib, making
 * `ctx.tools[TOOL_RUNTIME_SCHEDULER]` undefined -> "reading 'prepare'".
 *
 * This script (idempotently) changes the scheduler key in
 * packages/core/tools/src/index.ts from Symbol(...) to Symbol.for(...).
 * After running it you must rebuild: `pnpm run build:lib:host`, then restart DSH.
 *
 * Usage:
 *   node scripts/patch-scheduler-symbol.mjs [--root <dsh-root>] [--apply]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const root = (() => { const i = args.indexOf('--root'); return i >= 0 ? args[i+1] : process.cwd() })()
const APPLY = args.includes('--apply')
const file = join(root, 'packages/core/tools/src/index.ts')

if (!existsSync(file)) { console.error('not found:', file); process.exit(1) }

const src = readFileSync(file, 'utf8')
const re = /(TOOL_RUNTIME_SCHEDULER[^=]*=\s*)Symbol\(('@deepseek-ai\/dsh-tools\.scheduler')\)/
const already = /Symbol\.for\('@deepseek-ai\/dsh-tools\.scheduler'\)/.test(src)

console.log(already ? 'Already using Symbol.for — nothing to do.'
  : re.test(src) ? 'Plain Symbol() found — patch needed.'
  : 'Scheduler declaration not matched; inspect manually.')

if (!APPLY || already || !re.test(src)) process.exit(0)

writeFileSync(file + '.bak-symfix', src)
writeFileSync(file, src.replace(re, "$1Symbol.for($2)"))
console.log('Patched (backup: index.ts.bak-symfix).')
console.log('Now run: pnpm run build:lib:host, then restart DSH.')
