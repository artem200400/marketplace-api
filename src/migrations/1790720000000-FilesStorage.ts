import { MigrationInterface, QueryRunner } from 'typeorm'

export class FilesStorage1790720000000 implements MigrationInterface {
  name = 'FilesStorage1790720000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "files" (
        "id" BIGSERIAL NOT NULL,
        "key" character varying(500) NOT NULL,
        "owner_id" BIGINT NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "content_type" character varying(120) NOT NULL,
        "size" BIGINT,
        "upload_id" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_files" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_files_key" UNIQUE ("key"),
        CONSTRAINT "CHK_files_status" CHECK ("status" IN ('PENDING', 'COMPLETED')),
        CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `)

    await queryRunner.query(`
      CREATE INDEX "idx_files_owner_created"
      ON "files" ("owner_id", "created_at" DESC)
    `)

    await queryRunner.query(`
      CREATE INDEX "idx_files_pending_created"
      ON "files" ("status", "created_at")
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "public"."idx_files_pending_created"')
    await queryRunner.query('DROP INDEX "public"."idx_files_owner_created"')
    await queryRunner.query('DROP TABLE "files"')
  }
}
