import type { Queryable }
    from './queryable.js'

export type UserRow = {
    id: string
    name: string
    email: string
    balance_cents: number
}

export class UserRepository {
    constructor(
        private readonly db: Queryable
    ) { }

    async create(input: {
        name: string
        email: string
        balanceCents?: number
    }): Promise<UserRow> {
        const result =
            await this.db.query<UserRow>(
                `
                INSERT INTO users (
                    name,
                    email,
                    balance_cents
                )
                VALUES ($1, $2, $3)
                RETURNING
                    id::text,
                    name,
                    email,
                    balance_cents
                `,
                [
                    input.name,
                    input.email,
                    input.balanceCents ?? 0
                ]
            )

        return result.rows[0]
    }

    async findByEmail(
        email: string
    ): Promise<UserRow | null> {
        const result =
            await this.db.query<UserRow>(
                `
                SELECT
                    id::text,
                    name,
                    email,
                    balance_cents
                FROM users
                WHERE email = $1
                `,
                [
                    email
                ]
            )

        return result.rows[0] ?? null
    }

    async upsert(input: {
        name: string
        email: string
        balanceCents?: number
    }): Promise<UserRow> {
        const result =
            await this.db.query<UserRow>(
                `
                INSERT INTO users (
                    name,
                    email,
                    balance_cents
                )
                VALUES ($1, $2, $3)

                ON CONFLICT (email)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    balance_cents =
                        EXCLUDED.balance_cents

                RETURNING
                    id::text,
                    name,
                    email,
                    balance_cents
                `,
                [
                    input.name,
                    input.email,
                    input.balanceCents ?? 0
                ]
            )

        return result.rows[0]
    }
}