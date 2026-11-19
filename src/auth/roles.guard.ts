import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    SetMetadata
} from '@nestjs/common'

import {
    Reflector
} from '@nestjs/core'

import type {
    UserRole
} from './auth.types.js'

import type {
    AuthenticatedRequest
} from './auth.guard.js'

const ROLES_KEY =
    'hw24_roles'

export const Roles = (
    ...roles: UserRole[]
) =>
    SetMetadata(
        ROLES_KEY,
        roles
    )

@Injectable()
export class RolesGuard
implements CanActivate {
    constructor(
        private readonly reflector:
            Reflector
    ) { }

    canActivate(
        context:
            ExecutionContext
    ): boolean {
        const roles =
            this.reflector
                .getAllAndOverride<
                    UserRole[]
                >(
                    ROLES_KEY,
                    [
                        context
                            .getHandler(),
                        context
                            .getClass()
                    ]
                )

        if (
            !roles ||
            roles.length === 0
        ) {
            return true
        }

        const request =
            context
                .switchToHttp()
                .getRequest<
                    AuthenticatedRequest
                >()

        if (
            !request.authUser ||
            !roles.includes(
                request.authUser.role
            )
        ) {
            throw new ForbiddenException(
                'Insufficient role'
            )
        }

        return true
    }
}
