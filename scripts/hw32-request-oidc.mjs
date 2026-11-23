import { writeFile } from 'node:fs/promises'

const output = process.argv[2]
const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
const audience = process.env.HW32_OIDC_AUDIENCE ?? 'hw32-ci'

if (!output || !requestUrl || !requestToken) {
  console.error('GitHub OIDC runtime inputs are unavailable')
  process.exit(2)
}

const separator = requestUrl.includes('?') ? '&' : '?'
const response = await fetch(
  requestUrl + separator + 'audience=' + encodeURIComponent(audience),
  {
    headers: {
      Authorization: 'bearer ' + requestToken
    }
  }
)

if (!response.ok) {
  console.error('OIDC request failed: ' + response.status)
  process.exit(1)
}

const body = await response.json()
if (!body.value) {
  console.error('OIDC response did not contain a token')
  process.exit(1)
}

await writeFile(output, body.value, { mode: 0o600 })
