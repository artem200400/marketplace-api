import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
    Relation
} from 'typeorm'

import { OrderItem } from './order-item.entity.js'

@Entity('products')
export class Product {
    @PrimaryGeneratedColumn({
        type: 'bigint'
    })
    id!: string

    @Column({
        type: 'varchar',
        length: 255
    })
    name!: string

    @Column({
        type: 'text'
    })
    description!: string

    @Column({
        name: 'price_cents',
        type: 'integer'
    })
    priceCents!: number

    @Column({
        type: 'integer'
    })
    stock!: number

    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamptz'
    })
    createdAt!: Date

    @OneToMany(
        () => OrderItem,
        (item: OrderItem) => item.product
    )
    orderItems!: Relation<OrderItem[]>
}