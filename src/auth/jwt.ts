import {
    createPrivateKey,
    createPublicKey,
    createSign,
    createVerify
} from 'node:crypto'

import type {
    AccessPayload
} from './auth.types.js'

export const algorithms = [
    'RS256'
] as const

function required(
    name: string
): string {
    const value =
        process.env[name]

    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}`
        )
    }

    return value
}

function pemFromBase64(
    name: string
): string {
    return Buffer
        .from(
            required(name),
            'base64'
        )
        .toString('utf8')
}

function encode(
    value: unknown
): string {
    return Buffer
        .from(
            JSON.stringify(value)
        )
        .toString('base64url')
}

export function signAccessToken(
    payload: AccessPayload
): string {
    const header = {
        alg: algorithms[0],
        typ: 'JWT',
        kid: required('JWT_KID')
    }

    const signingInput =
        `${encode(header)}.${encode(payload)}`

    const signer =
        createSign('RSA-SHA256')

    signer.update(signingInput)
    signer.end()

    const signature =
        signer.sign(
            createPrivateKey(
                pemFromBase64(
                    'JWT_PRIVATE_KEY'
                )
            )
        )

    return `${signingInput}.${signature.toString('base64url')}`
}

export function verifyAccessToken(
    token: string
): AccessPayload {
    const parts =
        token.split('.')

    if (parts.length !== 3) {
        throw new Error(
            'Malformed access token'
        )
    }

    const [
        headerPart,
        payloadPart,
        signaturePart
    ] = parts

    const header =
        JSON.parse(
            Buffer.from(
                headerPart,
                'base64url'
            ).toString('utf8')
        ) as {
            alg?: string
            kid?: string
        }

    if (
        !algorithms.includes(
            header.alg as 'RS256'
        ) ||
        header.kid !==
        required('JWT_KID')
    ) {
        throw new Error(
            'JWT algorithm or kid is not allowed'
        )
    }

    const verifier =
        createVerify('RSA-SHA256')

    verifier.update(
        `${headerPart}.${payloadPart}`
    )
    verifier.end()

    const valid =
        verifier.verify(
            createPublicKey(
                pemFromBase64(
                    'JWT_PUBLIC_KEY'
                )
            ),
            Buffer.from(
                signaturePart,
                'base64url'
            )
        )

    if (!valid) {
        throw new Error(
            'Invalid access token signature'
        )
    }

    const payload =
        JSON.parse(
            Buffer.from(
                payloadPart,
                'base64url'
            ).toString('utf8')
        ) as AccessPayload

    const now =
        Math.floor(
            Date.now() / 1000
        )

    if (
        payload.iss !==
        'marketplace-api' ||
        payload.aud !==
        'marketplace-client' ||
        !payload.sub ||
        !payload.jti ||
        !payload.exp ||
        payload.exp <= now
    ) {
        throw new Error(
            'Invalid or expired access token'
        )
    }

    return payload
}

export function requireAuthEnvironment(): void {
    required('JWT_KID')
    required('JWT_PRIVATE_KEY')
    required('JWT_PUBLIC_KEY')
    required('REFRESH_TOKEN_PEPPER')
}
