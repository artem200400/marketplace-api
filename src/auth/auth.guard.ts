import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException
} from '@nestjs/common'

import type {
    Request
} from 'express'

import {
    AuthService
} from './auth.service.js'

import type {
    AuthenticatedUser
} from './auth.types.js'

export type AuthenticatedRequest =
    Request & {
        authUser?: AuthenticatedUser
    }

@Injectable()
export class AuthGuard
implements CanActivate {
    constructor(
        private readonly auth:
            AuthService
    ) { }

    async canActivate(
        context:
            ExecutionContext
    ): Promise<boolean> {
        const request =
            context
                .switchToHttp()
                .getRequest<
                    AuthenticatedRequest
                >()

        const header =
            request.headers
                .authorization

        if (
            !header ||
            !header.startsWith(
                'Bearer '
            )
        ) {
            throw new UnauthorizedException(
                'Bearer token is required'
            )
        }

        const token =
            header.slice(
                'Bearer '.length
            )

        request.authUser =
            await this.auth
                .verifyAccess(
                    token
                )

        return true
    }
}
