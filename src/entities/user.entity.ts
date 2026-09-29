import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn
} from 'typeorm'

import type { Relation } from 'typeorm'

import { Order } from './order.entity.js'

@Entity('users')
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