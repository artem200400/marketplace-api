import {
    MatchersV3,
    PactV3
} from '@pact-foundation/pact'

import {
    resolve
} from 'node:path'

const {
    integer,
    like
} = MatchersV3

describe(
    'Marketplace frontend contract',
    () => {
        it(
            'gets an existing order',
            async () => {
                const provider =
                    new PactV3({
                        consumer:
                            'MarketplaceFrontend',

                        provider:
                            'MarketplaceAPI',

                        dir:
                            resolve(
                                process.cwd(),
                                'pacts'
                            )
                    })

                provider
                    .given(
                        'order 1 exists'
                    )
                    .uponReceiving(
                        'a request for an existing order'
                    )
                    .withRequest({
                        method:
                            'GET',

                        path:
                            '/orders/1'
                    })
                    .willRespondWith({
                        status:
                            200,

                        headers: {
                            'Content-Type':
                                like(
                                    'application/json; charset=utf-8'
                                )
                        },

                        body: {
                            id:
                                like(
                                    '1'
                                ),

                            items:
                                like([
                                    {
                                        product_id:
                                            like(
                                                '1'
                                            ),

                                        quantity:
                                            integer(
                                                2
                                            ),

                                        unit_price_cents:
                                            integer(
                                                12999
                                            )
                                    }
                                ]),

                            total_cents:
                                integer(
                                    25998
                                ),

                            created_at:
                                like(
                                    '2026-10-05T12:00:00.000Z'
                                )
                        }
                    })

                await provider.executeTest(
                    async mockServer => {
                        const response =
                            await fetch(
                                `${mockServer.url}/orders/1`
                            )

                        expect(
                            response.status
                        ).toBe(
                            200
                        )

                        const body =
                            await response.json() as {
                                id: string

                                total_cents:
                                number

                                items: Array<{
                                    product_id:
                                    string

                                    quantity:
                                    number

                                    unit_price_cents:
                                    number
                                }>
                            }

                        expect(
                            body.id
                        ).toBeDefined()

                        expect(
                            body.total_cents
                        ).toBe(
                            25998
                        )

                        expect(
                            body.items
                        ).toHaveLength(
                            1
                        )
                    }
                )
            }
        )
    }
)