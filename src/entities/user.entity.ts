import {
    Check,
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn
} from 'typeorm'

import type { Relation } from 'typeorm'

import { Order } from './order.entity.js'

@Entity('users')
@Check(
    'CHK_users_balance_cents',
    `"balance_cents" >= 0`
)
export class User {
    @PrimaryGeneratedColumn({
        type: 'bigint'
    })
    id!: string

    @Column({
        type: 'varchar',
        length: 120
    })
    name!: string

    @Column({
        type: 'varchar',
        length: 255,
        unique: true
    })
    email!: string

    @Column({
        name: 'balance_cents',
        type: 'integer',
        default: 0
    })
    balanceCents!: number

    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamptz'
    })
    createdAt!: Date

    @OneToMany(
        () => Order,
        (order: Order) => order.user
    )
    orders!: Relation<Order[]>
}