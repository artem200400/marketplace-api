import 'reflect-metadata'

import AppDataSource from './data-source.js'

import { User } from './entities/user.entity.js'
import { Product } from './entities/product.entity.js'
import {
    Order,
    OrderStatus
} from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'

type SeedUser = {
    name: string
    email: string
    balanceCents: number
}

type SeedProduct = {
    name: string
    description: string
    priceCents: number
    stock: number
}

type SeedOrder = {
    userEmail: string
    status: OrderStatus
    createdAt: Date
    items: Array<{
        productName: string
        quantity: number
    }>
}

const users: SeedUser[] = [
    {
        name: 'Artem',
        email: 'artem@example.com',
        balanceCents: 10_000_000
    },
    {
        name: 'Anna',
        email: 'anna@example.com',
        balanceCents: 10_000_000
    },
    {
        name: 'Oleksandr',
        email: 'oleksandr@example.com',
        balanceCents: 10_000_000
    },
    {
        name: 'Maria',
        email: 'maria@example.com',
        balanceCents: 10_000_000
    },
    {
        name: 'Erik',
        email: 'erik@example.com',
        balanceCents: 10_000_000
    }
]

const products: SeedProduct[] = [
    {
        name: 'Gaming Mouse',
        description:
            'Lightweight gaming mouse with RGB lighting',
        priceCents: 49900,
        stock: 25
    },
    {
        name: 'Mechanical Keyboard',
        description:
            'Mechanical keyboard with tactile switches',
        priceCents: 89900,
        stock: 18
    },
    {
        name: 'Gaming Headset',
        description:
            'Stereo gaming headset with microphone',
        priceCents: 69900,
        stock: 30
    },
    {
        name: 'USB Microphone',
        description:
            'USB microphone for streaming and calls',
        priceCents: 109900,
        stock: 12
    },
    {
        name: 'Web Camera',
        description:
            'Full HD web camera for video calls',
        priceCents: 79900,
        stock: 20
    },
    {
        name: 'Mouse Pad',
        description:
            'Large mouse pad for keyboard and mouse',
        priceCents: 24900,
        stock: 50
    }
]

const orders: SeedOrder[] = [
    {
        userEmail: 'artem@example.com',
        status: 'completed',
        createdAt:
            new Date('2026-01-10T10:00:00.000Z'),
        items: [
            {
                productName: 'Gaming Mouse',
                quantity: 1
            },
            {
                productName: 'Mouse Pad',
                quantity: 1
            }
        ]
    },
    {
        userEmail: 'anna@example.com',
        status: 'shipped',
        createdAt:
            new Date('2026-01-11T11:00:00.000Z'),
        items: [
            {
                productName: 'Mechanical Keyboard',
                quantity: 1
            },
            {
                productName: 'Gaming Headset',
                quantity: 1
            }
        ]
    },
    {
        userEmail: 'oleksandr@example.com',
        status: 'pending',
        createdAt:
            new Date('2026-01-12T12:00:00.000Z'),
        items: [
            {
                productName: 'USB Microphone',
                quantity: 1
            },
            {
                productName: 'Web Camera',
                quantity: 1
            }
        ]
    },
    {
        userEmail: 'maria@example.com',
        status: 'cancelled',
        createdAt:
            new Date('2026-01-13T13:00:00.000Z'),
        items: [
            {
                productName: 'Gaming Headset',
                quantity: 2
            },
            {
                productName: 'Mouse Pad',
                quantity: 1
            }
        ]
    },
    {
        userEmail: 'erik@example.com',
        status: 'completed',
        createdAt:
            new Date('2026-01-14T14:00:00.000Z'),
        items: [
            {
                productName: 'Gaming Mouse',
                quantity: 1
            },
            {
                productName: 'Mechanical Keyboard',
                quantity: 1
            }
        ]
    }
]

async function seed(): Promise<void> {
    await AppDataSource.initialize()

    console.log('Database connected')

    const userRepository =
        AppDataSource.getRepository(User)

    const productRepository =
        AppDataSource.getRepository(Product)

    const orderRepository =
        AppDataSource.getRepository(Order)

    const orderItemRepository =
        AppDataSource.getRepository(OrderItem)

    try {
        await AppDataSource.transaction(
            async manager => {
                const usersByEmail =
                    new Map<string, User>()

                for (const data of users) {
                    let user =
                        await manager.findOne(
                            User,
                            {
                                where: {
                                    email: data.email
                                }
                            }
                        )

                    if (!user) {
                        user =
                            manager.create(
                                User,
                                data
                            )

                        user =
                            await manager.save(
                                user
                            )
                    } else {
                        user.name =
                            data.name

                        user.balanceCents =
                            data.balanceCents

                        user =
                            await manager.save(
                                user
                            )
                    }

                    usersByEmail.set(
                        user.email,
                        user
                    )
                }

                const productsByName =
                    new Map<string, Product>()

                for (const data of products) {
                    let product =
                        await manager.findOne(
                            Product,
                            {
                                where: {
                                    name: data.name
                                }
                            }
                        )

                    if (!product) {
                        product =
                            manager.create(
                                Product,
                                data
                            )

                        product =
                            await manager.save(
                                product
                            )
                    } else {
                        product.description =
                            data.description

                        product.priceCents =
                            data.priceCents

                        product.stock =
                            data.stock

                        product =
                            await manager.save(
                                product
                            )
                    }

                    productsByName.set(
                        product.name,
                        product
                    )
                }

                for (
                    const orderData
                    of orders
                ) {
                    const user =
                        usersByEmail.get(
                            orderData.userEmail
                        )

                    if (!user) {
                        throw new Error(
                            `User not found: ${orderData.userEmail}`
                        )
                    }

                    let totalAmountCents = 0

                    for (
                        const itemData
                        of orderData.items
                    ) {
                        const product =
                            productsByName.get(
                                itemData.productName
                            )

                        if (!product) {
                            throw new Error(
                                `Product not found: ${itemData.productName}`
                            )
                        }

                        totalAmountCents +=
                            product.priceCents *
                            itemData.quantity
                    }

                    let order =
                        await manager.findOne(
                            Order,
                            {
                                where: {
                                    userId:
                                        user.id,

                                    createdAt:
                                        orderData
                                            .createdAt
                                }
                            }
                        )

                    if (!order) {
                        order =
                            manager.create(
                                Order,
                                {
                                    userId:
                                        user.id,

                                    status:
                                        orderData
                                            .status,

                                    totalAmountCents,

                                    createdAt:
                                        orderData
                                            .createdAt
                                }
                            )

                        order =
                            await manager.save(
                                order
                            )
                    } else {
                        order.status =
                            orderData.status

                        order.totalAmountCents =
                            totalAmountCents

                        order =
                            await manager.save(
                                order
                            )
                    }

                    for (
                        const itemData
                        of orderData.items
                    ) {
                        const product =
                            productsByName.get(
                                itemData.productName
                            )

                        if (!product) {
                            throw new Error(
                                `Product not found: ${itemData.productName}`
                            )
                        }

                        let existingItem =
                            await manager.findOne(
                                OrderItem,
                                {
                                    where: {
                                        orderId:
                                            order.id,

                                        productId:
                                            product.id
                                    }
                                }
                            )

                        if (!existingItem) {
                            existingItem =
                                manager.create(
                                    OrderItem,
                                    {
                                        orderId:
                                            order.id,

                                        productId:
                                            product.id,

                                        quantity:
                                            itemData
                                                .quantity,

                                        unitPriceCents:
                                            product
                                                .priceCents
                                    }
                                )

                            await manager.save(
                                existingItem
                            )
                        } else {
                            existingItem.quantity =
                                itemData.quantity

                            existingItem.unitPriceCents =
                                product.priceCents

                            await manager.save(
                                existingItem
                            )
                        }
                    }
                }
            }
        )

        const [
            userCount,
            productCount,
            orderCount,
            orderItemCount
        ] = await Promise.all([
            userRepository.count(),
            productRepository.count(),
            orderRepository.count(),
            orderItemRepository.count()
        ])

        console.log('')
        console.log('Seed completed')
        console.log(
            `users: ${userCount}`
        )
        console.log(
            `products: ${productCount}`
        )
        console.log(
            `orders: ${orderCount}`
        )
        console.log(
            `order_items: ${orderItemCount}`
        )
    } finally {
        await AppDataSource.destroy()
    }
}

seed().catch(error => {
    console.error('Seed failed')
    console.error(error)
    process.exit(1)
})