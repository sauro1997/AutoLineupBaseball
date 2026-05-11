import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFilePath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(currentFilePath), '..')
const packageJsonPath = resolve(repoRoot, 'package.json')
const outputPath = resolve(repoRoot, 'public', 'version.json')

const packageJsonRaw = await readFile(packageJsonPath, 'utf8')
const packageJson = JSON.parse(packageJsonRaw)

const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
const commitRef = process.env.COMMIT_REF ?? process.env.GITHUB_SHA ?? ''
const buildId = commitRef || `${Date.now()}`

const payload = {
  version,
  buildId,
  generatedAt: new Date().toISOString(),
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
