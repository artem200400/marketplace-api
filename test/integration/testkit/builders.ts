let sequence = 0

export function aUser(
    overrides: Partial<{
        name: string
        email: string
        balanceCents: number
    }> = {}
) {
    sequence += 1

    return {
        name:
            overrides.name ??
            `User ${sequence}`,

        email:
            overrides.email ??
            `user-${sequence}-${Date.now()}@example.com`,

        balanceCents:
            overrides.balanceCents ??
            100_000
    }
}

export function aProduct(
    overrides: Partial<{
        name: string
        description: string
        priceCents: number
        stock: number
    }> = {}
) {
    sequence += 1

    return {
        name:
            overrides.name ??
            `Product ${sequence}`,

        description:
            overrides.description ??
            'Integration test product',

        priceCents:
            overrides.priceCents ??
            1000,

        stock:
            overrides.stock ??
            5
    }
}