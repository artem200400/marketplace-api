export type OrderPlacedEvent = {
    eventId: string

    type: 'order.placed'

    occurredAt: string

    data: {
        orderId: string
        userId: string
        totalCents: number
    }
}