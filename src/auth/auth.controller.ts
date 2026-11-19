import {
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    Req,
    UseGuards
} from '@nestjs/common'

import type {
    Request
} from 'express'

import {
    AuthGuard,
    type AuthenticatedRequest
} from './auth.guard.js'

import {
    AuthService
} from './auth.service.js'

@Controller('auth')
export class AuthController {
    constructor(
        private readonly auth:
            AuthService
    ) { }

    @Post('login')
    @HttpCode(200)
    login(
        @Body()
        body: {
            email: string
            password: string
        }
    ) {
        return this.auth.login(
            body.email,
            body.password
        )
    }

    @Post('refresh')
    @HttpCode(200)
    refresh(
        @Body()
        body: {
            refreshToken: string
        }
    ) {
        return this.auth.refresh(
            body.refreshToken
        )
    }

    @Post('logout')
    @HttpCode(204)
    @UseGuards(AuthGuard)
    async logout(
        @Req()
        request:
            AuthenticatedRequest,

        @Body()
        body: {
            refreshToken: string
        }
    ) {
        await this.auth.logout(
            request.authUser!,
            body.refreshToken
        )
    }

    @Get('me')
    @UseGuards(AuthGuard)
    me(
        @Req()
        request:
            Request &
            AuthenticatedRequest
    ) {
        return {
            id:
                request
                    .authUser!
                    .id,
            role:
                request
                    .authUser!
                    .role
        }
    }
}
