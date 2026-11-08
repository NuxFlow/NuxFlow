// pnpm starters:build <folder...> — builds, signs and (optionally) uploads the starter-site
// catalog every NuxFlow install reads (server/utils/starters/catalog.ts). Pass every starter
// folder each time (or one folder holding them all): the catalog lists exactly what you give it.
//
//   --out <dir>        where to write the publishable files (default: .starters-out)
//   --key <file>       the private signing key (default: ../../MYSTUFF/starters-signing-key.txt);
//                      the last non-comment line of the file is the key
//   --upload <bucket>  also upload everything to that R2 bucket (wrangler r2 object put --remote)
//   --keygen <file>    make a new signing key pair instead, write it to <file>, and print the
//                      public key (set NUXT_STARTERS_PUBLIC_KEY to it, or pin it in catalog.ts)
//
// Publishing: serve the bucket at the catalog's address (default https://starters.nuxflow.dev,
// an R2 custom domain). Files sit under <id>/<version>/, so a new version never changes
// what an install already under way is downloading.
import { spawnSync } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { catalogSigningInput, type StarterCatalogFile } from '../../shared/lib/starters'
import { APP_DIR, REPO_ROOT, fail, heading, runMain } from '../release/shell'
import { parseStarterDemo } from '../../server/utils/starters/demo'
import { CATALOG_CACHE, buildStarter, catalogPayload, readStarterMeta, type OutputFile, type SourceFile } from './lib'

// `pnpm starters:build` from the repo root runs this inside apps/nuxflow (pnpm -C); pnpm keeps
// the folder it was started from in INIT_CWD, so relative paths mean what the user typed.
const CALLER_DIR = process.env.INIT_CWD || process.cwd()

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function positional(): string[] {
  const out: string[] = []
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) { i++; continue }
    out.push(args[i]!)
  }
  return out
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name.startsWith('.') ? [] : listFiles(full, root)
    return [relative(root, full).replace(/\\/g, '/')]
  })
}

/** A starter folder has a demo.json; any other folder is searched one level down. */
function starterFolders(paths: string[]): string[] {
  return paths.flatMap((p) => {
    // Relative to where the command was run, else to the repo root (so `MYSTUFF/…` works
    // from apps/nuxflow too).
    const dir = [resolve(CALLER_DIR, p), resolve(REPO_ROOT, p)].find(d => existsSync(d))
    if (!dir) fail(`${p} doesn't exist (looked in ${CALLER_DIR} and ${REPO_ROOT})`)
    if (existsSync(join(dir, 'demo.json'))) return [dir]
    return readdirSync(dir).map(n => join(dir, n)).filter(d => statSync(d).isDirectory() && existsSync(join(d, 'demo.json')))
  })
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

async function keygen(file: string) {
  if (existsSync(file)) fail(`${file} already exists — not overwriting a signing key`)
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const priv = b64url(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))
  const pub = b64url(await webcrypto.subtle.exportKey('spki', pair.publicKey))
  writeFileSync(file, `# NuxFlow starter catalog signing key. KEEP PRIVATE. Never commit.\n# Public key: ${pub}\n${priv}\n`)
  console.log(`Wrote ${file}\nPublic key: ${pub}`)
}

async function sign(payload: string, keyFile: string): Promise<string> {
  if (!existsSync(keyFile)) fail(`Signing key not found at ${keyFile} (use --key, or --keygen to make one)`)
  const line = readFileSync(keyFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).pop()
  if (!line) fail(`${keyFile} has no key in it`)
  const key = await webcrypto.subtle.importKey('pkcs8', Buffer.from(line, 'base64url'), { name: 'Ed25519' }, false, ['sign'])
  return b64url(await webcrypto.subtle.sign({ name: 'Ed25519' }, key, catalogSigningInput(payload)))
}

/**
 * Runs wrangler's own script with Node directly — no shell. The release scripts' helper goes
 * through a shell on Windows (pnpm is a .cmd there) and so refuses arguments like a
 * `C:\…` path or `public, max-age=…`; here every argument reaches wrangler exactly as written.
 */
function wrangler(args: string[]): boolean {
  // Wrangler's package exports don't include its bin script, so it's found by path (pnpm
  // links the package into apps/nuxflow/node_modules).
  const bin = join(APP_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!existsSync(bin)) fail(`wrangler not found at ${bin} — run pnpm install`)
  const res = spawnSync(process.execPath, [bin, ...args], { cwd: APP_DIR, stdio: 'inherit' })
  if (res.error) fail(`Couldn't run wrangler: ${res.error.message}`)
  return res.status === 0
}

function upload(bucket: string, outDir: string, files: OutputFile[]) {
  heading(`Uploading ${files.length} files to R2 bucket ${bucket}`)
  files.forEach((f, i) => {
    console.log(`  [${i + 1}/${files.length}] ${f.key}`)
    const ok = wrangler([
      'r2', 'object', 'put', `${bucket}/${f.key}`,
      '--file', join(outDir, f.key),
      '--content-type', f.contentType,
      '--cache-control', f.cacheControl,
      '--remote',
    ])
    if (!ok) fail(`Upload of ${f.key} failed — run again to retry (uploads are safe to repeat)`)
  })
  console.log(`
Done. Check it at the catalog address, e.g. https://starters.nuxflow.dev/catalog.json`)
}

async function main() {
  const keygenFile = arg('keygen')
  if (keygenFile) return keygen(resolve(CALLER_DIR, keygenFile))

  const folders = starterFolders(positional())
  if (folders.length === 0) fail('Give at least one starter folder (one with a demo.json), or a folder of them')
  const outDir = resolve(CALLER_DIR, arg('out') ?? join(APP_DIR, '.starters-out'))
  const keyFile = resolve(CALLER_DIR, arg('key') ?? join(REPO_ROOT, 'MYSTUFF', 'starters-signing-key.txt'))
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

  heading(`Building ${folders.length} starter site(s)`)
  const built = folders.map((dir) => {
    const files: SourceFile[] = listFiles(dir).map(path => ({ path, bytes: new Uint8Array(readFileSync(join(dir, path))) }))
    const meta = readStarterMeta(basename(dir), readJson(join(dir, 'starter.json')), readJson(join(dir, 'theme.json')))
    const result = buildStarter(meta, files, sha256)
    // The same check an install runs, so a broken starter fails here, not on someone's site.
    try {
      parseStarterDemo(readFileSync(join(dir, 'demo.json'), 'utf8'))
    } catch (err) {
      fail(`${meta.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
    const bytes = result.files.reduce((n, f) => n + f.bytes.byteLength, 0)
    console.log(`  ${meta.id} ${meta.version} — ${result.entry.images.length} images, ${(bytes / 1048576).toFixed(1)} MB`)
    for (const w of result.warnings) console.log(`    ! ${w}`)
    return result
  })

  const payload = JSON.stringify(catalogPayload(built.map(b => b.entry)))
  const catalog: StarterCatalogFile = { format: 'nuxflow-starter-catalog', version: 1, payload, signature: await sign(payload, keyFile) }
  const catalogFile: OutputFile = {
    key: 'catalog.json',
    bytes: new TextEncoder().encode(JSON.stringify(catalog, null, 2)),
    contentType: 'application/json',
    cacheControl: CATALOG_CACHE,
  }
  const all = [...built.flatMap(b => b.files), catalogFile]

  // Emptied rather than deleted: on Windows a folder something has open can't be removed.
  mkdirSync(outDir, { recursive: true })
  for (const name of readdirSync(outDir)) rmSync(join(outDir, name), { recursive: true, force: true })
  for (const f of all) {
    const path = join(outDir, f.key)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, f.bytes)
  }
  console.log(`\nWrote ${all.length} files to ${outDir}`)

  const bucket = arg('upload')
  // catalog.json goes last, so it never lists a file that isn't up yet.
  if (bucket) upload(bucket, outDir, all)
  else console.log('Not uploaded (add --upload <bucket> to publish).')
}

runMain(main)
