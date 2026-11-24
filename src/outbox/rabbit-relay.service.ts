import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { DatabaseService } from '../database/database.service.js'
import { RabbitPublisher } from '../messaging/rabbit.publisher.js'
import type { OrderPlacedEvent } from '../messaging/order-placed.event.js'
import { logJson } from '../observability/logger.js'

type Pending = { id: string; payload: OrderPlacedEvent }

@Injectable()
export class RabbitOutboxRelay implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private running = false
  constructor(private readonly db: DatabaseService, private readonly publisher: RabbitPublisher) {}

  onModuleInit(): void {
    if (!process.env.BROKER_URL) return
    this.timer = setInterval(() => void this.tick(), 500)
    this.timer.unref()
    void this.tick()
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.db.withClient(async client => {
        await client.query('BEGIN')
        try {
          const events = (await client.query<Pending>(`
            SELECT id::text, payload FROM outbox
            WHERE published_at IS NULL ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED LIMIT 10
          `)).rows
          for (const event of events) {
            // Publish first, then mark published; an interrupted relay may redeliver.
            await this.publisher.publishOrderPlaced(event.payload)
            await client.query(
              'UPDATE outbox SET published_at=now(),attempts=attempts+1 WHERE id=$1', [event.id]
            )
            logJson('outbox.relay', 'published', { event_id: event.id })
          }
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })
    } catch (error) {
      logJson('outbox.relay', 'publish_failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.running = false
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
