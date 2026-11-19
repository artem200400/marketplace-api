import {
    MigrationInterface,
    QueryRunner
} from 'typeorm'

export class AuthSecurity1790715000000
implements MigrationInterface {
    name = 'AuthSecurity1790715000000'

    public async up(
        queryRunner: QueryRunner
    ): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN "role"
            character varying(20)
            NOT NULL DEFAULT 'buyer'
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN "password_hash"
            text
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD CONSTRAINT "CHK_users_role"
            CHECK ("role" IN ('buyer', 'seller', 'admin'))
        `)

        await queryRunner.query(`
            CREATE TABLE "refresh_tokens" (
                "id" BIGSERIAL PRIMARY KEY,
                "user_id" bigint NOT NULL,
                "family_id" uuid NOT NULL,
                "token_hash" character varying(64) NOT NULL,
                "used_at" TIMESTAMP WITH TIME ZONE,
                "revoked_at" TIMESTAMP WITH TIME ZONE,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_refresh_tokens_hash" UNIQUE ("token_hash"),
                CONSTRAINT "FK_refresh_tokens_user"
                    FOREIGN KEY ("user_id")
                    REFERENCES "users"("id")
                    ON DELETE CASCADE
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_refresh_tokens_family"
            ON "refresh_tokens" ("family_id")
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_refresh_tokens_hash"
            ON "refresh_tokens" ("token_hash")
        `)

        await queryRunner.query(`
            CREATE TABLE "access_token_denylist" (
                "jti" uuid PRIMARY KEY,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_access_denylist_expires"
            ON "access_token_denylist" ("expires_at")
        `)
    }

    public async down(
        queryRunner: QueryRunner
    ): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "access_token_denylist"
        `)

        await queryRunner.query(`
            DROP TABLE "refresh_tokens"
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP CONSTRAINT "CHK_users_role"
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN "password_hash"
        `)

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN "role"
        `)
    }
}
