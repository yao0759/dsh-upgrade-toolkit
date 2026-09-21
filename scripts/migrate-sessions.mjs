#!/usr/bin/env node
/**
 * migrate-sessions.mjs — Fix DSH v0 sessions after upgrading to a newer host
 * (developed and verified against the 0.1.6-alpha jump).
 *
 * Two things are repaired, both observed in production:
 *   1. Payload rule: a plugin `source` that carries a `summary` must use
 *      `form: "notice"`. Older DSH wrote `form: "instructions" | "recall"`
 *      together with a stray `summary`. The newer format validator rejects
 *      these with: `source summary requires notice form`.
 *      -> the redundant `summary` is removed (it is a display-only title;
 *         instructions/recall content is untouched).
 *
 *   2. Multi-frame Zstandard layout: the FIRST frame of session.jsonl.zstd
 *      must independently decode to exactly the one header line; the body is
 *      streamed in subsequent checksummed frames. Recompressing the whole
 *      file with an ordinary zstd CLI breaks this and yields:
 *      `first frame is not exactly one header`, which cascades and makes the
 *      workspace registry fail to activate (model tab stuck "loading").
 *      -> we rebuild the exact framing using node:zlib.
 *
 * Usage:
 *   node migrate-sessions.mjs [--root ~/.dsh/sessions] [--apply]
 *   (without --apply it only scans and reports; safe to run)
 *
 * Requires Node.js >= 22 (built-in zstd support in node:zlib).
 */

import { readdirSync, statSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import zlib from 'node:zlib'

const ZSTD_CHECKSUM_FLAG = zlib.constants.ZSTD_c_checksumFlag
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const ROOT = flag('--root', join(process.env.HOME || '~', '.dsh', 'sessions'))
const APPLY = args.includes('--apply')

/** Recursively remove invalid `summary` fields; returns the count. */
function fixNode(node) {
  let n = 0
  if (Array.isArray(node)) {
    for (const x of node) n += fixNode(x)
  } else if (node && typeof node === 'object') {
    if (node.kind === 'plugin' && 'summary' in node && node.form !== 'notice') {
      delete node.summary
      n++
    }
    for (const k of Object.keys(node)) n += fixNode(node[k])
  }
  return n
}

/** Count invalid `summary` fields without mutating. */
function countNode(node) {
  let n = 0
  if (Array.isArray(node)) {
    for (const x of node) n += countNode(x)
  } else if (node && typeof node === 'object') {
    if (node.kind === 'plugin' && 'summary' in node && node.form !== 'notice') n++
    for (const k of Object.keys(node)) n += countNode(node[k])
  }
  return n
}

function walk(d) {
  let out = []
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (e === 'session.jsonl.zstd') out.push(p)
  }
  return out
}

const ZSTD_LEVEL = 3 // match the reference layout; level only affects size, not framing validity

/** Compress one independently-decodable, checksummed Zstandard frame. */
function compressFrame(input) {
  return zlib.zstdCompressSync(Buffer.from(input), {
    level: ZSTD_LEVEL,
    params: { [ZSTD_CHECKSUM_FLAG]: 1 },
  })
}

/** Compress the streaming body frames (checksum flag enabled). */
function compressBody(input) {
  return zlib.zstdCompressSync(Buffer.from(input), {
    level: ZSTD_LEVEL,
    params: { [ZSTD_CHECKSUM_FLAG]: 1 },
  })
}

console.log(`DSH session migration tool`)
console.log(`Root: ${ROOT}`)
console.log(`Mode: ${APPLY ? 'APPLY (files will be changed)' : 'dry-run (use --apply to write)'}\n`)

if (!existsSync(ROOT)) {
  console.error(`ERROR: sessions directory not found: ${ROOT}`)
  process.exit(1)
}

const files = walk(ROOT)
let affected = 0, fixed = 0

for (const F of files) {
  const r = spawnSync('zstd', ['-dc', F], { maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) {
    console.log(`! cannot decompress: ${F}`)
    continue
  }
  const lines = r.stdout.toString().split('\n')
  const parsed = []
  let need = 0
  for (const line of lines) {
    if (line === '') { parsed.push(null); continue }
    const o = JSON.parse(line)
    parsed.push(o)
    need += countNode(o)
  }
  if (need === 0) continue
  affected++
  const label = dirname(F).replace(ROOT, '').replace(/^[/\\]/, '') || basename(dirname(F))
  console.log(`needs ${need} fix(es): ${label}`)
  if (!APPLY) continue

  const bak = F + '.predsmfix.bak'
  if (!existsSync(bak)) writeFileSync(bak, readFileSync(F))

  let did = 0
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i]) {
      did += fixNode(parsed[i])
      lines[i] = JSON.stringify(parsed[i])
    }
  }

  // Rebuild the multi-frame layout: frame 1 = header only, frame 2+ = body.
  const headerFrame = compressFrame(lines[0] + '\n')
  const bodyFrame = compressBody(lines.slice(1).join('\n'))
  const tmp = F + '.new'
  writeFileSync(tmp, Buffer.concat([headerFrame, bodyFrame]))

  const t = spawnSync('zstd', ['-t', tmp], { maxBuffer: 64 * 1024 * 1024 })
  if (t.status !== 0) {
    console.log(`  ! rebuilt file failed validation; original kept: ${label}`)
    continue
  }
  renameSync(tmp, F)
  fixed++
  console.log(`  fixed (${did} field(s)): ${label}`)
}

console.log(`\nScanned ${files.length} session(s); ${affected} affected; ${
  APPLY ? `${fixed} repaired.` : 'run with --apply to repair.'
}`)
if (APPLY && fixed > 0) console.log('Restart your DSH service for the changes to take effect.')
