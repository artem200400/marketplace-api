import {
    OnModuleDestroy,
    OnModuleInit
} from '@nestjs/common'

import {
    ConnectedSocket,
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from '@nestjs/websockets'

import type {
    Server,
    Socket
} from 'socket.io'

import type {
    Subscription
} from 'rxjs'

import {
    OrderEventsService
} from './order-events.service.js'

import { AuthService } from './auth/auth.service.js'

import {
    OrdersService
} from './orders.service.js'

type JoinPayload = {
    orderId: string
}

@WebSocketGateway({
    cors: {
        origin: '*'
    }
})
export class OrdersGateway
    implements
    OnModuleInit,
    OnModuleDestroy {
    @WebSocketServer()
    server!: Server

    private subscription:
        Subscription | undefined

    constructor(
        private readonly orders:
            OrdersService,

        private readonly orderEvents:
            OrderEventsService,

        private readonly auth: AuthService
    ) { }

    onModuleInit() {
        this.subscription =
            this.orderEvents
                .events$
                .subscribe(
                    event => {
                        this.server
                            .to(
                                `orders:${event.orderId}`
                            )
                            .emit(
                                'order.status',
                                event
                            )
                    }
                )
    }

    onModuleDestroy() {
        this.subscription
            ?.unsubscribe()
    }

    @SubscribeMessage(
        'join'
    )
    async joinOrder(
        @ConnectedSocket()
        socket: Socket,

        @MessageBody()
        payload: JoinPayload
    ) {
        const orderId =
            String(
                payload?.orderId ??
                ''
            )

        let userId: string
        try {
            const token = socket.handshake.auth?.token
            if (typeof token !== 'string') return {ok:false,error:'UNAUTHORIZED'}
            const principal = await this.auth.authenticate('Bearer ' + token)
            userId = principal.id
        } catch {
            return {ok:false,error:'UNAUTHORIZED'}
        }

        if (!orderId) {
            return {
                ok:
                    false,

                error:
                    'ORDER_ID_REQUIRED'
            }
        }

        try {
            await this.orders
                .assertOrderOwner(
                    orderId,
                    userId
                )
        }
        catch {
            return {
                ok:
                    false,

                error:
                    'FORBIDDEN'
            }
        }

        await socket.join(
            `orders:${orderId}`
        )

        return {
            ok:
                true,

            room:
                `orders:${orderId}`
        }
    }
}