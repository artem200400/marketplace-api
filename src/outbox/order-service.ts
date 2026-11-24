import type { PoolClient } from 'pg'
import { createHash } from 'node:crypto'

export type OrderInput = {
  userId: string
  idempotencyKey: string
  items: Array<{ product_id: string; quantity: number }>
}
export type OrderResponse = {
  id: string
  items: Array<{ product_id: string; quantity: number; unit_price_cents: number }>
  total_cents: number
  created_at: string
}
type OrderRow = { id: string; total_amount_cents: number; created_at: Date }

export async function inTransaction<T>(client: PoolClient, action: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await action()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function readOrder(client: PoolClient, id: string): Promise<OrderResponse> {
  const order = (await client.query<OrderRow>(
    'SELECT id::text, total_amount_cents, created_at FROM orders WHERE id=$1', [id]
  )).rows[0]
  if (!order) throw new Error('IDEMPOTENCY_ORDER_MISSING')
  const items = (await client.query<{
    product_id: string; quantity: number; unit_price_cents: number
  }>('SELECT product_id::text, quantity, unit_price_cents FROM order_items WHERE order_id=$1 ORDER BY id', [id])).rows
  return { id: order.id, items, total_cents: order.total_amount_cents,
    created_at: order.created_at.toISOString() }
}

export async function placeOrder(
  client: PoolClient,
  input: OrderInput,
  options: { failAfterOutbox?: boolean } = {}
): Promise<OrderResponse> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new Error('INVALID_IDEMPOTENCY_KEY')
  if (!input.items.length || input.items.some(i =>
    !i.product_id || !Number.isInteger(i.quantity) || i.quantity < 1
  )) throw new Error('INVALID_ITEMS')

  // A unique constraint serializes concurrent requests for the same intent.
  // ON CONFLICT DO NOTHING is atomic; SELECT-before-INSERT would race.
  const claimed = await client.query(
    `INSERT INTO order_idempotency(user_id, idempotency_key)
     VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`,
    [input.userId, input.idempotencyKey]
  )
  if (claimed.rowCount === 0) {
    const existing = (await client.query<{ order_id: string | null }>(
      'SELECT order_id::text FROM order_idempotency WHERE user_id=$1 AND idempotency_key=$2',
      [input.userId, input.idempotencyKey]
    )).rows[0]
    if (!existing?.order_id) throw new Error('IDEMPOTENCY_INCOMPLETE')
    return readOrder(client, existing.order_id)
  }

  const items: OrderResponse['items'] = []
  for (const item of input.items) {
    const product = (await client.query<{ id: string; price_cents: number }>(
      'SELECT id::text, price_cents FROM products WHERE id=$1', [item.product_id]
    )).rows[0]
    if (!product) throw new Error('PRODUCT_NOT_FOUND')
    items.push({ product_id: product.id, quantity: item.quantity,
      unit_price_cents: Number(product.price_cents) })
  }
  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0)
  if (!Number.isSafeInteger(total)) throw new Error('INVALID_TOTAL')

  const order = (await client.query<OrderRow>(
    `INSERT INTO orders(user_id,status,total_amount_cents) VALUES($1,'pending',$2)
     RETURNING id::text,total_amount_cents,created_at`, [input.userId, total]
  )).rows[0]
  for (const item of items) {
    await client.query(
      'INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES($1,$2,$3,$4)',
      [order.id, item.product_id, item.quantity, item.unit_price_cents]
    )
  }

  // Explicit event contract: never serialize an ORM entity into a public event.
  // UUID based on business identity, compatible with RabbitMQ consumer dedup.
  const hash = createHash('sha256').update('order.placed:' + order.id).digest('hex')
  const eventId = [hash.slice(0,8),hash.slice(8,12),'5'+hash.slice(13,16),
    ((parseInt(hash[16],16)&3)|8).toString(16)+hash.slice(17,20),hash.slice(20,32)].join('-')
  const payload = {
    eventId,
    type: 'order.placed',
    occurredAt: order.created_at.toISOString(),
    data: { orderId: order.id, userId: input.userId, totalCents: total }
  }
  await client.query(
    `INSERT INTO outbox(aggregate_type,aggregate_id,type,payload)
     VALUES('Order',$1,'order.placed',$2::jsonb)`,
    [order.id, JSON.stringify(payload)]
  )
  // Crash injection happens AFTER outbox insertion but BEFORE COMMIT.
  if (options.failAfterOutbox) throw new Error('SIMULATED_WRITE_CRASH')

  await client.query(
    'UPDATE order_idempotency SET order_id=$3 WHERE user_id=$1 AND idempotency_key=$2',
    [input.userId, input.idempotencyKey, order.id]
  )
  return { id: order.id, items, total_cents: total,
    created_at: order.created_at.toISOString() }
}
