import {
    MigrationInterface,
    QueryRunner
} from 'typeorm'

export class ConcurrencySupport1790710000000
implements MigrationInterface {
    name =
        'ConcurrencySupport1790710000000'

    public async up(
        queryRunner: QueryRunner
    ): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN "balance_cents"
            integer NOT NULL DEFAULT 0
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD CONSTRAINT "CHK_users_balance_cents"
            CHECK ("balance_cents" >= 0)
        `)

        await queryRunner.query(`
            CREATE TABLE "job_queue" (
                "id" BIGSERIAL NOT NULL,

                "type"
                    character varying(80)
                    NOT NULL,

                "payload"
                    jsonb
                    NOT NULL,

                "status"
                    character varying(20)
                    NOT NULL
                    DEFAULT 'pending',

                "processed"
                    integer
                    NOT NULL
                    DEFAULT 0,

                "processed_by"
                    character varying(80),

                "processed_at"
                    TIMESTAMP WITH TIME ZONE,

                "created_at"
                    TIMESTAMP WITH TIME ZONE
                    NOT NULL
                    DEFAULT now(),

                CONSTRAINT "CHK_job_queue_processed"
                    CHECK ("processed" >= 0),

                CONSTRAINT "CHK_job_queue_status"
                    CHECK (
                        "status" IN (
                            'pending',
                            'done'
                        )
                    ),

                CONSTRAINT "PK_job_queue"
                    PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX
                "idx_job_queue_pending_created"
            ON "job_queue" (
                "status",
                "created_at"
            )
        `)
    }

    public async down(
        queryRunner: QueryRunner
    ): Promise<void> {
        await queryRunner.query(`
            DROP INDEX
            "public"."idx_job_queue_pending_created"
        `)

        await queryRunner.query(`
            DROP TABLE "job_queue"
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP CONSTRAINT
            "CHK_users_balance_cents"
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN "balance_cents"
        `)
    }
}