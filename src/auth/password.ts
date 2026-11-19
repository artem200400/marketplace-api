import {
    randomBytes,
    scryptSync,
    timingSafeEqual
} from 'node:crypto'

export function hashPassword(
    password: string
): string {
    const salt =
        randomBytes(16)

    const hash =
        scryptSync(
            password,
            salt,
            32
        )

    return [
        'scrypt',
        salt.toString('base64url'),
        hash.toString('base64url')
    ].join('$')
}

export function verifyPassword(
    password: string,
    encoded: string
): boolean {
    const [
        scheme,
        saltText,
        hashText
    ] = encoded.split('$')

    if (
        scheme !== 'scrypt' ||
        !saltText ||
        !hashText
    ) {
        return false
    }

    const expected =
        Buffer.from(
            hashText,
            'base64url'
        )

    const actual =
        scryptSync(
            password,
            Buffer.from(
                saltText,
                'base64url'
            ),
            expected.length
        )

    return (
        expected.length ===
        actual.length &&
        timingSafeEqual(
            expected,
            actual
        )
    )
}
