import { MigrationInterface, QueryRunner } from 'typeorm'

export class TransactionalOutbox1790720000000 implements MigrationInterface {
  name = 'TransactionalOutbox1790720000000'

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE order_idempotency (
        user_id bigint NOT NULL REFERENCES users(id),
        idempotency_key varchar(200) NOT NULL,
        order_id bigint REFERENCES orders(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, idempotency_key)
      )
    `)
    await q.query(`
      CREATE TABLE outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_type varchar(80) NOT NULL,
        aggregate_id varchar(80) NOT NULL,
        type varchar(120) NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        attempts integer NOT NULL DEFAULT 0
      )
    `)
    await q.query(`CREATE INDEX idx_outbox_unpublished ON outbox(created_at, id) WHERE published_at IS NULL`)
    await q.query(`
      CREATE TABLE processed_messages (
        message_id uuid NOT NULL,
        consumer varchar(100) NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, consumer)
      )
    `)
    await q.query(`
      CREATE TABLE order_effects (
        order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await q.query(`
      CREATE TABLE broker_deliveries (
        id bigserial PRIMARY KEY,
        message_id uuid NOT NULL,
        delivered_at timestamptz NOT NULL DEFAULT now()
      )
    `)
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE broker_deliveries')
    await q.query('DROP TABLE order_effects')
    await q.query('DROP TABLE processed_messages')
    await q.query('DROP INDEX idx_outbox_unpublished')
    await q.query('DROP TABLE outbox')
    await q.query('DROP TABLE order_idempotency')
  }
}
