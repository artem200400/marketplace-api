import { MigrationInterface, QueryRunner } from 'typeorm'
export class CourseworkAuthRate1790750000000 implements MigrationInterface {
  name = 'CourseworkAuthRate1790750000000'
  async up(q:QueryRunner):Promise<void> {
    await q.query(`CREATE TABLE auth_rate_limits(
      key varchar(255) PRIMARY KEY,
      window_start timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0
    )`)
  }
  async down(q:QueryRunner):Promise<void> { await q.query('DROP TABLE auth_rate_limits') }
}
