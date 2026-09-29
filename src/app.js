import express from 'express'
import * as OpenApiValidator from 'express-openapi-validator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename =
    fileURLToPath(import.meta.url)

const __dirname =
    path.dirname(__filename)

const app = express()

app.use(express.json())


const products = [
    {
        id: 'prod_1',
        name: 'Mechanical Keyboard',
        price_cents: 12999
    },
    {
        id: 'prod_2',
        name: 'Gaming Mouse',
        price_cents: 6999
    }
]


const orders = []

const idempotencyStore =
    new Map()


app.use(
    OpenApiValidator.middleware({
        apiSpec: path.join(
            __dirname,
            '../openapi/openapi.yaml'
        ),
        validateRequests: true,
        validateResponses: true
    })
)


app.get(
    '/products',
    (req, res) => {
        const limit =
            Number(
                req.query.limit ?? 20
            )

        const items =
            products.slice(
                0,
                limit
            )

        res.json({
            items,
            next_cursor: null
        })
    }
)


app.get(
    '/products/:id',
    (req, res) => {
        const product =
            products.find(
                item =>
                    item.id ===
                    req.params.id
            )

        if (!product) {
            res
                .status(404)
                .type(
                    'application/problem+json'
                )
                .json({
                    type:
                        'https://example.com/problems/not-found',

                    title:
                        'Product not found',

                    status:
                        404,

                    detail:
                        `Product ${req.params.id} was not found`,

                    instance:
                        req.originalUrl
                })

            return
        }

        res.json(product)
    }
)


app.get(
    '/orders',
    (req, res) => {
        const limit =
            Number(
                req.query.limit ?? 20
            )

        res.json({
            items:
                orders.slice(
                    0,
                    limit
                ),

            next_cursor:
                null
        })
    }
)


app.get(
    '/orders/:id',
    (req, res) => {
        const order =
            orders.find(
                item =>
                    item.id ===
                    req.params.id
            )

        if (!order) {
            res
                .status(404)
                .type(
                    'application/problem+json'
                )
                .json({
                    type:
                        'https://example.com/problems/not-found',

                    title:
                        'Order not found',

                    status:
                        404,

                    detail:
                        `Order ${req.params.id} was not found`,

                    instance:
                        req.originalUrl
                })

            return
        }

        res.json(order)
    }
)


app.post(
    '/orders',
    (req, res) => {
        const idempotencyKey =
            req.headers[
                'idempotency-key'
            ]

        const bodyKey =
            JSON.stringify(
                req.body
            )

        const existing =
            idempotencyStore.get(
                idempotencyKey
            )


        if (existing) {
            if (
                existing.bodyKey !==
                bodyKey
            ) {
                res
                    .status(422)
                    .type(
                        'application/problem+json'
                    )
                    .json({
                        type:
                            'https://example.com/problems/idempotency-conflict',

                        title:
                            'Idempotency conflict',

                        status:
                            422,

                        detail:
                            'The same Idempotency-Key was used with a different request body.',

                        instance:
                            req.originalUrl
                    })

                return
            }


            res.setHeader(
                'Idempotency-Replay',
                'true'
            )

            res
                .status(201)
                .json(
                    existing.response
                )

            return
        }


        const items =
            req.body.items.map(
                item => {
                    const product =
                        products.find(
                            product =>
                                product.id ===
                                item.product_id
                        )

                    const unitPrice =
                        product
                            ?.price_cents
                        ?? 0

                    return {
                        product_id:
                            item.product_id,

                        quantity:
                            item.quantity,

                        unit_price_cents:
                            unitPrice
                    }
                }
            )


        const totalCents =
            items.reduce(
                (
                    total,
                    item
                ) =>
                    total +
                    (
                        item
                            .unit_price_cents
                        *
                        item.quantity
                    ),
                0
            )


        const order = {
            id:
                `order_${orders.length + 1}`,

            items,

            total_cents:
                totalCents,

            created_at:
                new Date()
                    .toISOString()
        }


        orders.push(order)


        idempotencyStore.set(
            idempotencyKey,
            {
                bodyKey,
                response:
                    order
            }
        )


        res
            .status(201)
            .json(order)
    }
)


app.use(
    (
        err,
        req,
        res,
        next
    ) => {
        const status =
            err.status ?? 500

        const detail =
            status >= 500
                ? 'Internal server error'
                : err.message

        res
            .status(status)
            .type(
                'application/problem+json'
            )
            .json({
                type:
                    `https://example.com/problems/${status}`,

                title:
                    status === 400
                        ? 'Bad Request'
                        : status === 404
                            ? 'Not Found'
                            : status === 422
                                ? 'Unprocessable Entity'
                                : 'Internal Server Error',

                status,

                detail,

                instance:
                    req.originalUrl
            })
    }
)


const PORT =
    Number(
        process.env.PORT ?? 3000
    )


app.listen(
    PORT,
    () => {
        console.log(
            `Marketplace API listening on http://localhost:${PORT}`
        )
    }
)