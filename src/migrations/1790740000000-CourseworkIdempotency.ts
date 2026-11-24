import { MigrationInterface, QueryRunner } from 'typeorm'

export class CourseworkIdempotency1790740000000 implements MigrationInterface {
  name = 'CourseworkIdempotency1790740000000'
  async up(q:QueryRunner):Promise<void> {
    await q.query('ALTER TABLE order_idempotency ADD COLUMN request_hash char(64)')
  }
  async down(q:QueryRunner):Promise<void> {
    await q.query('ALTER TABLE order_idempotency DROP COLUMN request_hash')
  }
}
