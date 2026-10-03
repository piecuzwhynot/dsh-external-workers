/**
 * Build the release artifact, the way a DSH plugin is meant to be installed.
 *
 * `dsh plugin add <path-or-url>` takes a tarball, so the release needs one — plus
 * checksums, because a plugin that runs other people's CLIs should be verifiable.
 *
 * Produces, in the output directory:
 *   dsh-external-workers-<version>.tgz   the versioned artifact
 *   dsh-external-workers.tgz             the same bytes under a stable name, so
 *                                        releases/latest/download/ keeps working
 *   SHA256SUMS                           checksums for both
 *
 * Usage: node scripts/release.mjs [output-directory]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outDir = resolve(process.argv[2] ?? join(root, 'dist'))
const staging = join(root, '.release-staging')

mkdirSync(outDir, { recursive: true })

// npm pack, into a staging dir so a stray file can never end up in the artifact.
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
// On Windows npm is a .cmd, and Node refuses to run one without a shell — so the
// shell is invoked explicitly instead of passing `shell: true` with arguments.
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
const npmArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd', 'pack', '--pack-destination', staging, '--json']
  : ['pack', '--pack-destination', staging, '--json']
const packed = execFileSync(npmCommand, npmArgs, { cwd: root, encoding: 'utf8' })
const info = JSON.parse(packed)
const entry = Array.isArray(info) ? info[0] : info
const tarball = join(staging, entry.filename)
if (statSync(tarball).size === 0) throw new Error('npm pack produced an empty tarball')

// What actually made it in — printed, because the whole point of `files` in
// package.json is that the artifact contains nothing else.
const listed = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
const files = listed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith('/') !== true && line.length > 0)
const suspicious = files.filter((file) => /node_modules|\.git\/|\.env|api-keys|\.release-staging/.test(file))
if (suspicious.length > 0) throw new Error(`the artifact must not contain: ${suspicious.slice(0, 5).join(', ')}`)

// Prove the artifact is the code we just tested: extract it and compare every
// file with the working tree. This is what catches "packed before rebuilding the
// client bundle" — a mistake that otherwise only shows up in someone else's DSH.
const extracted = join(staging, 'extracted')
mkdirSync(extracted, { recursive: true })
execFileSync('tar', ['-xzf', tarball, '-C', extracted], { encoding: 'utf8' })
const shaFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const mismatched = []
for (const file of files) {
  const relative = file.replace(/^package\//, '')
  if (relative === 'package.json') continue // npm normalises this one
  const inArtifact = join(extracted, 'package', relative)
  const inTree = join(root, relative)
  try {
    if (shaFile(inArtifact) !== shaFile(inTree)) mismatched.push(relative)
  } catch {
    mismatched.push(`${relative} (missing from the working tree)`)
  }
}
if (mismatched.length > 0) {
  throw new Error(`the artifact does not match the working tree: ${mismatched.join(', ')} — rebuild before releasing`)
}
const packedPkg = JSON.parse(readFileSync(join(extracted, 'package', 'package.json'), 'utf8'))
if (packedPkg.version !== pkg.version) throw new Error(`tarball version ${packedPkg.version} != package.json ${pkg.version}`)

const versioned = join(outDir, entry.filename)
const stable = join(outDir, 'dsh-external-workers.tgz')
copyFileSync(tarball, versioned)
copyFileSync(tarball, stable)

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const sums = [
  `${sha(versioned)}  ${entry.filename}`,
  `${sha(stable)}  dsh-external-workers.tgz`,
].join('\n')
writeFileSync(join(outDir, 'SHA256SUMS'), `${sums}\n`, 'utf8')

rmSync(staging, { recursive: true, force: true })

console.log(`${pkg.name} ${pkg.version}`)
console.log(`artifact: ${versioned} (${(statSync(versioned).size / 1024).toFixed(1)} KB)`)
console.log(`stable:   ${stable}`)
console.log(`checksums: ${join(outDir, 'SHA256SUMS')}`)
console.log(`\n${files.length} files inside:`)
for (const file of files.sort()) console.log(`  ${file}`)
if (files.length !== entry.entryCount) console.log(`  (npm counted ${entry.entryCount} entries)`)
