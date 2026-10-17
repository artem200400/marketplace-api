import {
    Injectable
} from '@nestjs/common'

import {
    Subject
} from 'rxjs'

export type OrderStatusEvent = {
    id: number
    orderId: string
    status: string
    createdAt: string
}

@Injectable()
export class OrderEventsService {
    private readonly subject =
        new Subject<OrderStatusEvent>()

    private readonly buffers =
        new Map<
            string,
            OrderStatusEvent[]
        >()

    private readonly counters =
        new Map<
            string,
            number
        >()

    readonly events$ =
        this.subject.asObservable()

    publishStatus(
        orderId: string,
        status: string
    ): OrderStatusEvent {
        const nextId =
            (
                this.counters.get(
                    orderId
                ) ?? 0
            ) + 1

        this.counters.set(
            orderId,
            nextId
        )

        const event:
            OrderStatusEvent = {
            id:
                nextId,

            orderId,

            status,

            createdAt:
                new Date()
                    .toISOString()
        }

        const existing =
            this.buffers.get(
                orderId
            ) ?? []

        existing.push(
            event
        )

        const maxEvents =
            100

        if (
            existing.length >
            maxEvents
        ) {
            existing.splice(
                0,
                existing.length -
                maxEvents
            )
        }

        this.buffers.set(
            orderId,
            existing
        )

        this.subject.next(
            event
        )

        return event
    }

    getMissedEvents(
        orderId: string,
        lastEventId: number
    ): OrderStatusEvent[] {
        const events =
            this.buffers.get(
                orderId
            ) ?? []

        return events.filter(
            event =>
                event.id >
                lastEventId
        )
    }
}