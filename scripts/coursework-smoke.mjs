import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { io } from 'socket.io-client'
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
  const stockBefore = Number((await db.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock)
  const body = JSON.stringify({items:[{ product_id: product.id, quantity: 1 }]})
  const init = {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...auth},body}
  const a = await api('/orders', init)
  const b = await api('/orders', init)
  assert.equal(a.id, b.id, 'same idempotency intent must not duplicate order')
  const stockAfter = Number((await db.query('SELECT stock FROM products WHERE id=$1',[product.id])).rows[0].stock)
  assert.equal(stockAfter,stockBefore-1,'same-key retry must decrement stock exactly once')
  const changed = await fetch(new URL('/orders',base),{
    method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':key,...auth},
    body:JSON.stringify({items:[{product_id:product.id,quantity:2}]})
  })
  assert.equal(changed.status,422,'same key with changed payload must fail')
  assert.match(changed.headers.get('content-type') ?? '',/application\/problem\+json/)
  const invalid = await fetch(new URL('/orders',base),{
    method:'POST',headers:{'Content-Type':'application/json',...auth},
    body:JSON.stringify({items:[{product_id:product.id,quantity:0}]})
  })
  assert.equal(invalid.status,400)
  assert.match(invalid.headers.get('content-type') ?? '',/application\/problem\+json/)
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
  // Assert authentication, ownership, role, logout and refresh reuse.
  const anonymous = await fetch(new URL('/orders/' + a.id,base))
  assert.equal(anonymous.status,401)
  const otherEmail = 'foreign-' + randomUUID() + '@example.invalid'
  await api('/auth/register', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:otherEmail,password})})
  const other = await api('/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:otherEmail,password})})
  const forbidden = await fetch(new URL('/orders/' + a.id,base),{
    headers:{Authorization:'Bearer '+other.access_token}
  })
  assert.equal(forbidden.status,403)
  // Verify an authenticated websocket room cannot be joined as another user.
  async function tryJoin(token,orderId) {
    const socket = io(base,{transports:['websocket'],reconnection:false,auth:{token}})
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Socket connect timeout')),5000)
        socket.once('connect',()=>{clearTimeout(timer);resolve()})
        socket.once('connect_error',e=>{clearTimeout(timer);reject(e)})
      })
      return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Socket ACK timeout')),5000)
        socket.emit('join',{orderId},answer=>{clearTimeout(timer);resolve(answer)})
      })
    } finally { socket.disconnect() }
  }
  const wsOwner = await tryJoin(tokens.access_token,a.id)
  assert.equal(wsOwner.ok,true)
  const wsForeign = await tryJoin(other.access_token,a.id)
  assert.equal(wsForeign.error,'FORBIDDEN')
  const wsAnonymous = await tryJoin('',a.id)
  assert.equal(wsAnonymous.error,'UNAUTHORIZED')
  console.log('ws-owner=1')
  console.log('ws-cross-user=403')
  console.log('ws-anonymous=401')
  const fakeUpload = await fetch(new URL('/uploads/intent',base),{
    method:'POST',headers:{'Content-Type':'application/json','x-user-id':'1'},
    body:JSON.stringify({contentType:'image/png',size:100})
  })
  assert.equal(fakeUpload.status,401)
  console.log('upload-spoof=401')
  const deniedRole = await fetch(new URL('/orders/' + a.id + '/status',base), {
    method:'PATCH',headers:{'Content-Type':'application/json',...auth},
    body:JSON.stringify({status:'cancelled'})
  })
  assert.equal(deniedRole.status,403)
  const refreshed = await api('/auth/refresh',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:tokens.refresh_token})})
  const reused = await fetch(new URL('/auth/refresh',base),{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:tokens.refresh_token})})
  assert.equal(reused.status,401)
  const afterReuse = await fetch(new URL('/orders/'+a.id,base),{
    headers:{Authorization:'Bearer '+refreshed.access_token}})
  assert.equal(afterReuse.status,401)
  await api('/auth/logout', {method:'POST', headers:{Authorization:'Bearer '+other.access_token}})
  const afterLogout = await fetch(new URL('/orders/'+a.id,base),{
    headers:{Authorization:'Bearer '+other.access_token}})
  assert.equal(afterLogout.status,401)
  // A shared database limiter must reject excessive login attempts with 429.
  let throttled = false
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(new URL('/auth/login',base), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'unknown-'+randomUUID()+'@example.invalid',password})
    })
    if (response.status === 429) {
      assert.match(response.headers.get('content-type') ?? '',/application\/problem\+json/)
      throttled = true
      break
    }
    assert.equal(response.status,401)
  }
  assert.equal(throttled,true,'auth login attempts must be rate limited')
  console.log('login-throttled=429')
  console.log('logout-revoked=401')
  console.log('anonymous=401')
  console.log('foreign=403')
  console.log('role-denied=403')
  console.log('refresh-reuse=401')
  console.log('family-revoked=401')
  console.log('idempotency-conflict=422')
  console.log('validation=400')
  console.log('requests=2')
  console.log('orders=1')
  console.log('stock-decrement=1')
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
