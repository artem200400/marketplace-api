import { createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('arguments must be --key value pairs')
    }
    out[key.slice(2)] = value
  }
  return out
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function wildcardToRegExp(pattern) {
  const special = '\\.^$+?()[]{}|'
  let escaped = ''

  for (const char of pattern) {
    if (char === '*') escaped += '.*'
    else if (special.includes(char)) escaped += '\\' + char
    else escaped += char
  }

  return new RegExp('^' + escaped + '$')
}

async function readJsonSource(source) {
  if (source.startsWith('file://')) {
    return JSON.parse(await readFile(new URL(source), 'utf8'))
  }

  const response = await fetch(source)
  if (!response.ok) {
    throw new Error('failed to fetch ' + source + ': ' + response.status)
  }

  return response.json()
}

const args = parseArgs(process.argv.slice(2))
const token = (await readFile(args['token-file'], 'utf8')).trim()
const policy = JSON.parse(await readFile(args.policy, 'utf8'))
const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')

if (!encodedHeader || !encodedPayload || !encodedSignature) {
  throw new Error('invalid JWT format')
}

const header = decodePart(encodedHeader)
const payload = decodePart(encodedPayload)

let jwksUrl = args.jwks

if (!jwksUrl && args.discovery) {
  const discovery = await readJsonSource(args.discovery)
  jwksUrl = discovery.jwks_uri
}

if (!jwksUrl) throw new Error('provide --jwks or --discovery')

const jwks = await readJsonSource(jwksUrl)
const jwk = (jwks.keys ?? []).find(key => key.kid === header.kid)
let signatureVerified = false

if (header.alg === 'RS256' && jwk) {
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
  signatureVerified = verify(
    'RSA-SHA256',
    Buffer.from(encodedHeader + '.' + encodedPayload),
    publicKey,
    Buffer.from(encodedSignature, 'base64url')
  )
}

const audValues = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
const subAllowed = (policy.allowedSub ?? []).some(pattern =>
  wildcardToRegExp(pattern).test(String(payload.sub ?? ''))
)

const now = Math.floor(Date.now() / 1000)
const timeValid =
  (payload.exp === undefined || Number(payload.exp) > now) &&
  (payload.nbf === undefined || Number(payload.nbf) <= now)

const policyAllowed =
  signatureVerified &&
  payload.iss === policy.issuer &&
  audValues.includes(policy.audience) &&
  subAllowed &&
  timeValid

console.log('oidc-iss=' + (payload.iss ?? ''))
console.log('oidc-aud=' + (Array.isArray(payload.aud) ? payload.aud.join(',') : payload.aud ?? ''))
console.log('oidc-sub=' + (payload.sub ?? ''))
console.log('sig-verified=' + (signatureVerified ? 1 : 0))
console.log('policy-allow=' + (policyAllowed ? 1 : 0))

process.exit(policyAllowed ? 0 : 1)
