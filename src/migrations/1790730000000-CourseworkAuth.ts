import { MigrationInterface, QueryRunner } from 'typeorm'

export class CourseworkAuth1790730000000 implements MigrationInterface {
  name = 'CourseworkAuth1790730000000'

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN password_hash text`)
    await q.query(`ALTER TABLE users ADD COLUMN role varchar(20) NOT NULL DEFAULT 'USER'`)
    await q.query(`ALTER TABLE users ADD CONSTRAINT users_role_valid CHECK (role IN ('USER','ADMIN'))`)
    await q.query(`
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY,
        family_id uuid NOT NULL,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_hash char(64) NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await q.query(`CREATE INDEX auth_sessions_user ON auth_sessions(user_id)`)
    await q.query(`CREATE INDEX auth_sessions_family ON auth_sessions(family_id)`)
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE auth_sessions')
    await q.query('ALTER TABLE users DROP CONSTRAINT users_role_valid')
    await q.query('ALTER TABLE users DROP COLUMN role')
    await q.query('ALTER TABLE users DROP COLUMN password_hash')
  }
}
