import { createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signToken(privateKey, kid, payload) {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid })
  const body = encode(payload)
  const signer = createSign('RSA-SHA256')
  signer.update(header + '.' + body)
  signer.end()
  const signature = signer.sign(privateKey).toString('base64url')
  return header + '.' + body + '.' + signature
}

function runGate(tokenFile, policyFile, jwksFile) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/oidc-gate.mjs',
      '--token-file', tokenFile,
      '--policy', policyFile,
      '--jwks', pathToFileURL(jwksFile).href
    ],
    { encoding: 'utf8' }
  )

  const values = {}
  for (const line of result.stdout.trim().split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1)
  }

  return {
    sig: Number(values['sig-verified'] ?? 0),
    allow: Number(values['policy-allow'] ?? 0)
  }
}

const temp = await mkdtemp(join(tmpdir(), 'hw32-oidc-'))

try {
  const issuer = 'https://local.hw32.example'
  const audience = 'hw32-local'
  const goodSub = 'repo:artem200400/marketplace-api:ref:refs/heads/hw-32'
  const foreignSub = 'repo:someone-else/foreign:ref:refs/heads/main'
  const kid = 'hw32-demo-key'

  const goodPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const wrongPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = goodPair.publicKey.export({ format: 'jwk' })
  publicJwk.kid = kid
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'

  const jwksFile = join(temp, 'jwks.json')
  const policyFile = join(temp, 'policy.json')

  await writeFile(jwksFile, JSON.stringify({ keys: [publicJwk] }))
  await writeFile(policyFile, JSON.stringify({
    issuer,
    audience,
    allowedSub: [goodSub]
  }))

  const now = Math.floor(Date.now() / 1000)
  const base = {
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 300
  }

  const cases = [
    ['green', signToken(goodPair.privateKey, kid, { ...base, sub: goodSub })],
    ['foreign-sub', signToken(goodPair.privateKey, kid, { ...base, sub: foreignSub })],
    ['bad-signature', signToken(wrongPair.privateKey, kid, { ...base, sub: goodSub })]
  ]

  const expected = {
    green: [1, 1],
    'foreign-sub': [1, 0],
    'bad-signature': [0, 0]
  }

  let bad = 0

  for (const [name, token] of cases) {
    const tokenFile = join(temp, name + '.jwt')
    await writeFile(tokenFile, token)

    const result = runGate(tokenFile, policyFile, jwksFile)
    console.log('case=' + name)
    console.log('sig-verified=' + result.sig)
    console.log('policy-allow=' + result.allow)

    const [sig, allow] = expected[name]
    if (result.sig !== sig || result.allow !== allow) bad += 1
  }

  process.exit(bad === 0 ? 0 : 1)
} finally {
  await rm(temp, { recursive: true, force: true })
}
