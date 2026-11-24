import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
const base = process.env.COURSEWORK_API_URL ?? 'http://127.0.0.1:23000'
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const key = 'coursework-smoke-' + randomUUID()
async function api(path, init) {
  const r = await fetch(new URL(path, base), init)
  const data = await r.json()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(data)}`)
  return data
}
try {
  const ready = await api('/readyz')
  assert.equal(ready.status, 'ready')
  const email = 'smoke-' + randomUUID() + '@example.invalid'
  const password = 'StrongExamplePassword-' + randomUUID()
  await api('/auth/register', {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password})})
  const tokens = await api('/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password})})
  const auth = {'Authorization':'Bearer '+tokens.access_token}
  const product = (await db.query('SELECT id::text FROM products ORDER BY id LIMIT 1')).rows[0]
  assert.ok(product, 'Run seed first')
  const body = JSON.stringify({items:[{ product_id: product.id, quantity: 1 }]})
  const init = {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...auth},body}
  const a = await api('/orders', init)
  const b = await api('/orders', init)
  assert.equal(a.id, b.id, 'same idempotency intent must not duplicate order')
  let order
  for (let attempt=0; attempt<80; attempt++) {
    order = await api('/orders/' + a.id, {headers:auth})
    if (order.status === 'completed') break
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  assert.equal(order?.status, 'completed', 'asynchronous consumer must complete order')
  const counts = (await db.query(`
    SELECT
     (SELECT count(*)::int FROM orders WHERE id=$1) AS orders,
     (SELECT count(*)::int FROM outbox WHERE aggregate_id=$1::text AND published_at IS NOT NULL) AS published,
     (SELECT count(*)::int FROM order_event_effects WHERE order_id=$1::text) AS effect
  `,[a.id])).rows[0]
  assert.deepEqual(counts,{orders:1,published:1,effect:1})
  console.log('requests=2')
  console.log('orders=1')
  console.log('published=1')
  console.log('effect=1')
  console.log('final-status=completed')
  console.log('coursework-smoke=PASS')
} catch(error) {
  console.error(error)
  process.exitCode=1
} finally {
  await db.end()
}
