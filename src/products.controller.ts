import {
    Body,
    Controller,
    HttpCode,
    Post,
    UseGuards
} from '@nestjs/common'

import {
    DatabaseService
} from './database/database.service.js'

import {
    AuthGuard
} from './auth/auth.guard.js'

import {
    Roles,
    RolesGuard
} from './auth/roles.guard.js'

@Controller('products')
export class ProductsController {
    constructor(
        private readonly database:
            DatabaseService
    ) { }

    @Post()
    @HttpCode(201)
    @UseGuards(
        AuthGuard,
        RolesGuard
    )
    @Roles(
        'seller',
        'admin'
    )
    async create(
        @Body()
        body: {
            name: string
            description?: string
            price_cents?: number
            stock?: number
        }
    ) {
        const result =
            await this.database.query<{
                id: string
            }>(
                `
                INSERT INTO products (
                    name,
                    description,
                    price_cents,
                    stock
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4
                )
                RETURNING id::text
                `,
                [
                    body.name ??
                        'HW24 product',
                    body.description ??
                        'RBAC demo product',
                    body.price_cents ??
                        100,
                    body.stock ??
                        1
                ]
            )

        return {
            id:
                result.rows[0].id
        }
    }
}
