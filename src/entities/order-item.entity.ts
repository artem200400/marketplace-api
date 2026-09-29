import {
    Check,
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn
} from 'typeorm'

import type { Relation } from 'typeorm'

import { Order } from './order.entity.js'
import { Product } from './product.entity.js'

@Entity('order_items')
@Check(
    'CHK_order_items_quantity',
    `"quantity" > 0`
)
@Check(
    'CHK_order_items_unit_price_cents',
    `"unit_price_cents" >= 0`
)
export class OrderItem {
    @PrimaryGeneratedColumn({
        type: 'bigint'
    })
    id!: string

    @Column({
        name: 'order_id',
        type: 'bigint'
    })
    orderId!: string

    @ManyToOne(
        () => Order,
        (order: Order) => order.items,
        {
            nullable: false,
            onDelete: 'CASCADE'
        }
    )
    @JoinColumn({
        name: 'order_id'
    })
    order!: Relation<Order>

    @Column({
        name: 'product_id',
        type: 'bigint'
    })
    productId!: string

    @ManyToOne(
        () => Product,
        (product: Product) => product.orderItems,
        {
            nullable: false,
            onDelete: 'RESTRICT'
        }
    )
    @JoinColumn({
        name: 'product_id'
    })
    product!: Relation<Product>

    @Column({
        type: 'integer'
    })
    quantity!: number

    @Column({
        name: 'unit_price_cents',
        type: 'integer'
    })
    unitPriceCents!: number
}