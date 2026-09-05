import fs from 'node:fs'
import path from 'node:path'

const schemaPath = path.resolve(
    'src/config/env.schema.ts'
)

const examplePath = path.resolve(
    '.env.example'
)

const schemaContent =
    fs.readFileSync(
        schemaPath,
        'utf8'
    )

const exampleContent =
    fs.readFileSync(
        examplePath,
        'utf8'
    )

const schemaMatches = [
    ...schemaContent.matchAll(
        /^\s*([A-Z][A-Z0-9_]*)\s*:/gm
    )
]

const schemaVariables =
    schemaMatches.map(
        match => match[1]
    )

const exampleVariables =
    exampleContent
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(
            line =>
                line &&
                !line.startsWith('#') &&
                line.includes('=')
        )
        .map(
            line =>
                line.split('=')[0]
                    .trim()
        )

const missing =
    schemaVariables.filter(
        variable =>
            !exampleVariables.includes(
                variable
            )
    )

const extra =
    exampleVariables.filter(
        variable =>
            !schemaVariables.includes(
                variable
            )
    )

if (
    missing.length > 0 ||
    extra.length > 0
) {
    console.error(
        'Environment example is out of sync.'
    )

    if (missing.length > 0) {
        console.error(
            `Missing in .env.example: ${missing.join(', ')}`
        )
    }

    if (extra.length > 0) {
        console.error(
            `Extra in .env.example: ${extra.join(', ')}`
        )
    }

    process.exit(1)
}

console.log(
    '.env.example is synchronized with env schema.'
)