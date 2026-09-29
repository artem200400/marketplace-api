import 'reflect-metadata'

import AppDataSource from './data-source.js'
import { OrderItem } from './entities/order-item.entity.js'

type ProductSalesReport = {
    productId: string
    productName: string
    totalQuantity: string
    orderCount: string
    revenueCents: string
}

async function main(): Promise<void> {
    await AppDataSource.initialize()

    try {
        const rows =
            await AppDataSource
                .getRepository(OrderItem)
                .createQueryBuilder('item')
                .innerJoin(
                    'item.product',
                    'product'
                )
                .select(
                    'product.id',
                    'productId'
                )
                .addSelect(
                    'product.name',
                    'productName'
                )
                .addSelect(
                    'SUM(item.quantity)',
                    'totalQuantity'
                )
                .addSelect(
                    'COUNT(DISTINCT item.order_id)',
                    'orderCount'
                )
                .addSelect(
                    'SUM(item.quantity * item.unit_price_cents)',
                    'revenueCents'
                )
                .groupBy(
                    'product.id'
                )
                .addGroupBy(
                    'product.name'
                )
                .orderBy(
                    '"revenueCents"',
                    'DESC'
                )
                .getRawMany<ProductSalesReport>()

        console.log('')
        console.log(
            '=== PRODUCT SALES REPORT ==='
        )

        for (const row of rows) {
            console.log(
                [
                    `Product: ${row.productName}`,
                    `quantity=${row.totalQuantity}`,
                    `orders=${row.orderCount}`,
                    `revenueCents=${row.revenueCents}`
                ].join(' | ')
            )
        }

        console.log('')
        console.log(
            `Rows: ${rows.length}`
        )
    } finally {
        await AppDataSource.destroy()
    }
}

main().catch(error => {
    console.error(
        'Report failed'
    )

    console.error(error)

    process.exit(1)
})