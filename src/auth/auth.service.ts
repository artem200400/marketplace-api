import {
    Injectable,
    UnauthorizedException
} from '@nestjs/common'

import {
    createHmac,
    randomBytes,
    randomUUID
} from 'node:crypto'

import {
    DatabaseService
} from '../database/database.service.js'

import {
    signAccessToken,
    verifyAccessToken
} from './jwt.js'

import {
    verifyPassword
} from './password.js'

import type {
    AccessPayload,
    AuthenticatedUser,
    UserRole
} from './auth.types.js'

type UserRow = {
    id: string
    role: UserRole
    password_hash: string | null
}

type RefreshRow = {
    id: string
    user_id: string
    family_id: string
    used_at: Date | null
    revoked_at: Date | null
    expires_at: Date
}

const ACCESS_TTL_SECONDS = 10 * 60
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

@Injectable()
export class AuthService {
    constructor(
        private readonly database:
            DatabaseService
    ) { }

    private required(
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

    private hashRefreshToken(
        token: string
    ): string {
        return createHmac(
            'sha256',
            this.required(
                'REFRESH_TOKEN_PEPPER'
            )
        )
            .update(token)
            .digest('hex')
    }

    private createAccessToken(
        user: {
            id: string
            role: UserRole
        }
    ) {
        const now =
            Math.floor(
                Date.now() / 1000
            )

        const payload:
            AccessPayload = {
            sub: user.id,
            role: user.role,
            jti: randomUUID(),
            iat: now,
            exp:
                now +
                ACCESS_TTL_SECONDS,
            iss: 'marketplace-api',
            aud: 'marketplace-client'
        }

        return {
            token:
                signAccessToken(
                    payload
                ),
            payload
        }
    }

    private createRefreshToken(): string {
        return randomBytes(48)
            .toString('base64url')
    }

    async login(
        email: string,
        password: string
    ) {
        const result =
            await this.database
                .query<UserRow>(
                    `
                    SELECT
                        id::text,
                        role,
                        password_hash
                    FROM users
                    WHERE lower(email) = lower($1)
                    LIMIT 1
                    `,
                    [
                        email
                    ]
                )

        const user =
            result.rows[0]

        if (
            !user ||
            !user.password_hash ||
            !verifyPassword(
                password,
                user.password_hash
            )
        ) {
            throw new UnauthorizedException(
                'Invalid credentials'
            )
        }

        const familyId =
            randomUUID()

        const refreshToken =
            this.createRefreshToken()

        const expiresAt =
            new Date(
                Date.now() +
                REFRESH_TTL_MS
            )

        await this.database.query(
            `
            INSERT INTO refresh_tokens (
                user_id,
                family_id,
                token_hash,
                expires_at
            )
            VALUES ($1, $2, $3, $4)
            `,
            [
                user.id,
                familyId,
                this.hashRefreshToken(
                    refreshToken
                ),
                expiresAt
            ]
        )

        const access =
            this.createAccessToken(
                user
            )

        return {
            accessToken:
                access.token,
            refreshToken,
            expiresIn:
                ACCESS_TTL_SECONDS
        }
    }

    async refresh(
        refreshToken: string
    ) {
        const tokenHash =
            this.hashRefreshToken(
                refreshToken
            )

        const nextRefresh =
            this.createRefreshToken()

        const nextHash =
            this.hashRefreshToken(
                nextRefresh
            )

        const nextExpires =
            new Date(
                Date.now() +
                REFRESH_TTL_MS
            )

        const outcome =
            await this.database
                .transaction(
                    async client => {
                        const result =
                            await client
                                .query<RefreshRow & {
                                    role: UserRole
                                }>(
                                    `
                                    SELECT
                                        rt.id::text,
                                        rt.user_id::text,
                                        rt.family_id::text,
                                        rt.used_at,
                                        rt.revoked_at,
                                        rt.expires_at,
                                        u.role
                                    FROM refresh_tokens rt
                                    JOIN users u
                                      ON u.id = rt.user_id
                                    WHERE rt.token_hash = $1
                                    FOR UPDATE
                                    `,
                                    [
                                        tokenHash
                                    ]
                                )

                        const row =
                            result.rows[0]

                        if (!row) {
                            return {
                                kind:
                                    'invalid'
                            } as const
                        }

                        const compromised =
                            row.used_at !== null ||
                            row.revoked_at !== null ||
                            row.expires_at
                                .getTime() <=
                                Date.now()

                        if (compromised) {
                            await client.query(
                                `
                                UPDATE refresh_tokens
                                SET revoked_at =
                                    COALESCE(
                                        revoked_at,
                                        NOW()
                                    )
                                WHERE family_id = $1
                                `,
                                [
                                    row.family_id
                                ]
                            )

                            console.warn(
                                `refresh reuse detected family_id=${row.family_id}`
                            )

                            return {
                                kind:
                                    'compromised'
                            } as const
                        }

                        await client.query(
                            `
                            UPDATE refresh_tokens
                            SET used_at = NOW()
                            WHERE id = $1
                            `,
                            [
                                row.id
                            ]
                        )

                        await client.query(
                            `
                            INSERT INTO refresh_tokens (
                                user_id,
                                family_id,
                                token_hash,
                                expires_at
                            )
                            VALUES ($1, $2, $3, $4)
                            `,
                            [
                                row.user_id,
                                row.family_id,
                                nextHash,
                                nextExpires
                            ]
                        )

                        return {
                            kind:
                                'ok',
                            user: {
                                id:
                                    row.user_id,
                                role:
                                    row.role
                            }
                        } as const
                    }
                )

        if (
            outcome.kind !==
            'ok'
        ) {
            throw new UnauthorizedException(
                'Refresh token is invalid'
            )
        }

        const access =
            this.createAccessToken(
                outcome.user
            )

        return {
            accessToken:
                access.token,
            refreshToken:
                nextRefresh,
            expiresIn:
                ACCESS_TTL_SECONDS
        }
    }

    async logout(
        user:
            AuthenticatedUser,
        refreshToken: string
    ): Promise<void> {
        const tokenHash =
            this.hashRefreshToken(
                refreshToken
            )

        const found =
            await this.database
                .transaction(
                    async client => {
                        const result =
                            await client
                                .query<{
                                    family_id: string
                                    user_id: string
                                }>(
                                    `
                                    SELECT
                                        family_id::text,
                                        user_id::text
                                    FROM refresh_tokens
                                    WHERE token_hash = $1
                                    FOR UPDATE
                                    `,
                                    [
                                        tokenHash
                                    ]
                                )

                        const row =
                            result.rows[0]

                        if (
                            !row ||
                            row.user_id !==
                            user.id
                        ) {
                            return false
                        }

                        await client.query(
                            `
                            UPDATE refresh_tokens
                            SET revoked_at =
                                COALESCE(
                                    revoked_at,
                                    NOW()
                                )
                            WHERE family_id = $1
                            `,
                            [
                                row.family_id
                            ]
                        )

                        await client.query(
                            `
                            INSERT INTO access_token_denylist (
                                jti,
                                expires_at
                            )
                            VALUES (
                                $1,
                                to_timestamp($2)
                            )
                            ON CONFLICT (jti)
                            DO UPDATE SET
                                expires_at =
                                    EXCLUDED.expires_at
                            `,
                            [
                                user.jti,
                                user.exp
                            ]
                        )

                        return true
                    }
                )

        if (!found) {
            throw new UnauthorizedException(
                'Refresh token is invalid'
            )
        }
    }

    async verifyAccess(
        token: string
    ): Promise<AuthenticatedUser> {
        let payload:
            AccessPayload

        try {
            payload =
                verifyAccessToken(
                    token
                )
        }
        catch {
            throw new UnauthorizedException(
                'Invalid access token'
            )
        }

        await this.database.query(
            `
            DELETE FROM access_token_denylist
            WHERE expires_at <= NOW()
            `
        )

        const denied =
            await this.database.query<{
                exists: boolean
            }>(
                `
                SELECT EXISTS (
                    SELECT 1
                    FROM access_token_denylist
                    WHERE jti = $1
                      AND expires_at > NOW()
                ) AS exists
                `,
                [
                    payload.jti
                ]
            )

        if (
            denied.rows[0]
                ?.exists
        ) {
            throw new UnauthorizedException(
                'Access token was revoked'
            )
        }

        return {
            id: payload.sub,
            role: payload.role,
            jti: payload.jti,
            exp: payload.exp
        }
    }
}
