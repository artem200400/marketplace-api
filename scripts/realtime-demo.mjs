import {
    io
} from 'socket.io-client'

const baseUrl =
    process.env.REALTIME_BASE_URL ??
    'http://127.0.0.1:3000'

const sameRoom =
    process.argv.includes(
        '--same-room'
    )

const orderA =
    process.env.ORDER_A ??
    '1'

const orderB =
    process.env.ORDER_B ??
    '2'

const roomB =
    sameRoom
        ? orderA
        : orderB

let aReceived = 0
let bReceived = 0

function sleep(
    milliseconds
) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    )
}

async function getOrder(
    orderId
) {
    const response =
        await fetch(
            `${baseUrl}/orders/${orderId}`
        )

    if (!response.ok) {
        throw new Error(
            `Cannot load order ${orderId}: ${response.status}`
        )
    }

    return response.json()
}

function createSocket(
    userId
) {
    return io(
        baseUrl,
        {
            transports: [
                'websocket'
            ],

            auth: {
                userId:
                    String(
                        userId
                    )
            },

            reconnection:
                false
        }
    )
}

function waitForConnect(
    socket
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            if (
                socket.connected
            ) {
                resolve()
                return
            }

            const timeout =
                setTimeout(
                    () => {
                        reject(
                            new Error(
                                'Socket connection timeout'
                            )
                        )
                    },
                    5000
                )

            socket.once(
                'connect',
                () => {
                    clearTimeout(
                        timeout
                    )

                    resolve()
                }
            )

            socket.once(
                'connect_error',
                error => {
                    clearTimeout(
                        timeout
                    )

                    reject(
                        error
                    )
                }
            )
        }
    )
}

function joinOrder(
    socket,
    orderId
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            const timeout =
                setTimeout(
                    () => {
                        reject(
                            new Error(
                                `Join timeout for order ${orderId}`
                            )
                        )
                    },
                    5000
                )

            socket.emit(
                'join',
                {
                    orderId:
                        String(
                            orderId
                        )
                },
                acknowledgement => {
                    clearTimeout(
                        timeout
                    )

                    if (
                        !acknowledgement
                            ?.ok
                    ) {
                        reject(
                            new Error(
                                `Join rejected for order ${orderId}: ${JSON.stringify(
                                    acknowledgement
                                )}`
                            )
                        )

                        return
                    }

                    resolve(
                        acknowledgement
                    )
                }
            )
        }
    )
}

async function main() {
    /*
     * Load the actual owners from the API.
     *
     * Different-room mode:
     *   A authenticates as owner of order A
     *   B authenticates as owner of order B
     *
     * Same-room mode:
     *   both authenticate as owner of order A
     */
    const orderAData =
        await getOrder(
            orderA
        )

    const orderBData =
        sameRoom
            ? orderAData
            : await getOrder(
                orderB
            )

    const userA =
        process.env
            .REALTIME_USER_A ??
        String(
            orderAData.user_id
        )

    const userB =
        process.env
            .REALTIME_USER_B ??
        String(
            orderBData.user_id
        )

    const socketA =
        createSocket(
            userA
        )

    const socketB =
        createSocket(
            userB
        )

    socketA.on(
        'order.status',
        event => {
            if (
                String(
                    event.orderId
                ) ===
                String(
                    orderA
                )
            ) {
                aReceived = 1
            }
        }
    )

    socketB.on(
        'order.status',
        event => {
            if (
                String(
                    event.orderId
                ) ===
                String(
                    orderA
                )
            ) {
                bReceived = 1
            }
        }
    )

    try {
        await Promise.all([
            waitForConnect(
                socketA
            ),

            waitForConnect(
                socketB
            )
        ])

        /*
         * Wait for join ACK before changing
         * the order status.
         */
        await joinOrder(
            socketA,
            orderA
        )

        await joinOrder(
            socketB,
            roomB
        )

        const statuses = [
            'shipped',
            'completed',
            'cancelled',
            'pending'
        ]

        const currentStatus =
            String(
                orderAData.status
            )

        const nextStatus =
            statuses.find(
                status =>
                    status !==
                    currentStatus
            ) ??
            'shipped'

        const response =
            await fetch(
                `${baseUrl}/orders/${orderA}/status`,
                {
                    method:
                        'PATCH',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({
                            status:
                                nextStatus
                        })
                }
            )

        if (!response.ok) {
            throw new Error(
                `Status update failed: ${response.status} ${await response.text()}`
            )
        }

        await sleep(
            800
        )

        console.log(
            `A_RECEIVED=${aReceived}`
        )

        console.log(
            `B_RECEIVED=${bReceived}`
        )

        const expectedB =
            sameRoom
                ? 1
                : 0

        const success =
            aReceived === 1 &&
            bReceived === expectedB

        socketA.disconnect()
        socketB.disconnect()

        process.exit(
            success
                ? 0
                : 1
        )
    }
    catch (error) {
        socketA.disconnect()
        socketB.disconnect()

        throw error
    }
}

main()
    .catch(
        error => {
            console.error(
                error instanceof Error
                    ? error.message
                    : error
            )

            console.log(
                `A_RECEIVED=${aReceived}`
            )

            console.log(
                `B_RECEIVED=${bReceived}`
            )

            process.exit(1)
        }
    )