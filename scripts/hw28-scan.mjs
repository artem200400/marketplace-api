import { spawnSync } from 'node:child_process'

const image = process.env.APP_IMAGE ?? 'marketplace-api:hw28'
const severity = process.env.SCAN_SEVERITY ?? 'HIGH,CRITICAL'
const maxAllowed = Number(process.env.SCAN_MAX ?? '20')

if (!Number.isFinite(maxAllowed)) {
  throw new Error('SCAN_MAX must be a number')
}

const scan = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    'aquasec/trivy:latest',
    'image',
    '--quiet',
    '--format',
    'json',
    '--severity',
    severity,
    image
  ],
  {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  }
)

if (scan.error) throw scan.error
if (scan.status !== 0) {
  process.stderr.write(scan.stderr || scan.stdout)
  process.exit(scan.status ?? 1)
}

const report = JSON.parse(scan.stdout)
let found = 0

for (const result of report.Results ?? []) {
  found += (result.Vulnerabilities ?? []).length
}

const pass = found <= maxAllowed

console.log(`image=${image}`)
console.log(`severity=${severity}`)
console.log(`found=${found}`)
console.log(`max-allowed=${maxAllowed}`)
console.log(`gate=${pass ? 'pass' : 'fail'}`)

process.exit(pass ? 0 : 1)
