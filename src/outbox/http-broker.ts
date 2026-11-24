import { createServer } from 'node:http'
import { Pool } from 'pg'

type Event = { id: string; type: string; payload: { orderId: string } }

const brokerUrl = new URL(process.env.BROKER_URL ?? 'http://127.0.0.1:18765')
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? process.env.DB_URL })

async function consume(event: Event): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(event.id) ||
    event.type !== 'OrderPlaced' || !/^\d+$/.test(String(event.payload?.orderId))) {
    throw new Error('INVALID_EVENT')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Delivery attempts are recorded even when the effect is a duplicate.
    await client.query('INSERT INTO broker_deliveries(message_id) VALUES($1)', [event.id])
    const claim = await client.query(
      `INSERT INTO processed_messages(message_id,consumer) VALUES($1,'order-effects')
       ON CONFLICT DO NOTHING RETURNING message_id`, [event.id]
    )
    if (claim.rowCount) {
      // Natural business key makes the effect independently idempotent too.
      await client.query(
        'INSERT INTO order_effects(order_id) VALUES($1) ON CONFLICT DO NOTHING',
        [event.payload.orderId]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const server = createServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    response.writeHead(200).end('ok')
    return
  }
  if (request.url !== '/events' || request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  try {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (Buffer.concat(chunks).length > 100_000) throw new Error('TOO_LARGE')
    const event = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Event
    await consume(event)
    response.writeHead(204).end()
  } catch (error) {
    console.error('broker rejected event:', error)
    response.writeHead(400).end('invalid event')
  }
})
server.listen(Number(brokerUrl.port || 80), brokerUrl.hostname)
process.on('SIGTERM', () => { server.close(); void pool.end() })
