import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn
} from 'typeorm'

import type { Relation } from 'typeorm'

import { User } from './user.entity.js'
import { OrderItem } from './order-item.entity.js'

export type OrderStatus =
    | 'pending'
    | 'shipped'
    | 'completed'
    | 'cancelled'

@Entity('orders')
@Check(
    'CHK_orders_status',
    `"status" IN (
        'pending',
        'shipped',
        'completed',
        'cancelled'
    )`
)
@Check(
    'CHK_orders_total_amount_cents',
    `"total_amount_cents" >= 0`
)
@Index(
    'idx_orders_user_created_at',
    ['userId', 'createdAt']
)
@Index(
    'idx_orders_cancelled_created_at',
    ['createdAt'],
    {
        where: `"status" = 'cancelled'`
    }
)
export class Order {
    @PrimaryGeneratedColumn({
        type: 'bigint'
    })
    id!: string

    @Column({
        name: 'user_id',
        type: 'bigint'
    })
    userId!: string

    @ManyToOne(
        () => User,
        (user: User) => user.orders,
        {
            nullable: false,
            onDelete: 'RESTRICT'
        }
    )
    @JoinColumn({
        name: 'user_id'
    })
    user!: Relation<User>

    @Column({
        type: 'varchar',
        length: 20
    })
    status!: OrderStatus

    @Column({
        name: 'total_amount_cents',
        type: 'integer'
    })
    totalAmountCents!: number

    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamptz'
    })
    createdAt!: Date

    @OneToMany(
        () => OrderItem,
        (item: OrderItem) => item.order
    )
    items!: Relation<OrderItem[]>
}