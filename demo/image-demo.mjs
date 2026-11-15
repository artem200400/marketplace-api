import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const image = process.env.APP_IMAGE ?? 'marketplace-api:hw28'
const tokenFile = process.env.NPM_TOKEN_FILE ?? '.npm_token'
const dockerfile = await readFile('docker/Dockerfile', 'utf8')
const stages = (dockerfile.match(/^FROM\s+/gmi) ?? []).length

const shell = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'true'], {
  stdio: 'ignore'
})
const shellInside = shell.status === 0 ? 1 : 0

const inspectRaw = execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .Config}}'], {
  encoding: 'utf8'
}).trim()
const config = JSON.parse(inspectRaw)
const runtimeUid = String(config.User ?? '').trim()

const token = (await readFile(tokenFile, 'utf8')).trim()
if (!token) throw new Error('Build token is empty')

const history = execFileSync('docker', ['history', '--no-trunc', image], { encoding: 'utf8' })
const imageInspect = execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' })

const temp = await mkdtemp(join(tmpdir(), 'hw28-image-'))
const tarPath = join(temp, 'image.tar')
try {
  execFileSync('docker', ['save', '-o', tarPath, image], { stdio: 'ignore' })
  const tar = await readFile(tarPath)

  const tokenInHistory = history.includes(token) ? 1 : 0
  const tokenInConfig = imageInspect.includes(token) ? 1 : 0
  const tokenInLayers = tar.includes(Buffer.from(token)) ? 1 : 0

  console.log(`stages=${stages}`)
  console.log(`shell-inside=${shellInside}`)
  console.log(`runtime-uid=${runtimeUid}`)
  console.log(`token-in-history=${tokenInHistory}`)
  console.log(`token-in-config=${tokenInConfig}`)
  console.log(`token-in-layers=${tokenInLayers}`)

  const uid = Number(runtimeUid)
  const ok =
    stages >= 2 &&
    shellInside === 0 &&
    Number.isFinite(uid) &&
    uid !== 0 &&
    tokenInHistory === 0 &&
    tokenInConfig === 0 &&
    tokenInLayers === 0

  if (!ok) process.exitCode = 1
} finally {
  await rm(temp, { recursive: true, force: true })
}
