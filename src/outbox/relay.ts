import type { Pool } from 'pg'

type PendingEvent = { id: string; type: string; payload: unknown }

export async function relayOnce(
  pool: Pool,
  brokerUrl: string,
  options: { crashAfterPublish?: boolean } = {}
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const rows = (await client.query<PendingEvent>(`
      SELECT id,type,payload FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at,id
      FOR UPDATE SKIP LOCKED LIMIT 10
    `)).rows
    let published = 0
    for (const event of rows) {
      const response = await fetch(new URL('/events', brokerUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event)
      })
      if (!response.ok) throw new Error(`BROKER_ERROR_${response.status}`)
      published++
      // A relay can die right here: external publish cannot be rolled back.
      if (options.crashAfterPublish) throw new Error('SIMULATED_RELAY_CRASH')
      await client.query(
        'UPDATE outbox SET published_at=now(),attempts=attempts+1 WHERE id=$1', [event.id]
      )
    }
    await client.query('COMMIT')
    return published
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
