import type { Queryable }
    from './queryable.js'

export type ProductRow = {
    id: string
    name: string
    description: string
    price_cents: number
    stock: number
}

export class ProductRepository {
    constructor(
        private readonly db: Queryable
    ) { }

    async create(input: {
        name: string
        description: string
        priceCents: number
        stock: number
    }): Promise<ProductRow> {
        const result =
            await this.db.query<ProductRow>(
                `
                INSERT INTO products (
                    name,
                    description,
                    price_cents,
                    stock
                )
                VALUES ($1, $2, $3, $4)

                RETURNING
                    id::text,
                    name,
                    description,
                    price_cents,
                    stock
                `,
                [
                    input.name,
                    input.description,
                    input.priceCents,
                    input.stock
                ]
            )

        return result.rows[0]
    }

    async findById(
        id: string
    ): Promise<ProductRow | null> {
        const result =
            await this.db.query<ProductRow>(
                `
                SELECT
                    id::text,
                    name,
                    description,
                    price_cents,
                    stock
                FROM products
                WHERE id = $1
                `,
                [
                    id
                ]
            )

        return result.rows[0] ?? null
    }

    async totalInventoryValue():
        Promise<number> {
        const result =
            await this.db.query<{
                total: string
            }>(
                `
                SELECT
                    COALESCE(
                        SUM(
                            price_cents * stock
                        ),
                        0
                    )::text AS total
                FROM products
                `
            )

        return Number(
            result.rows[0].total
        )
    }
}