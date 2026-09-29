import {
    MigrationInterface,
    QueryRunner
} from 'typeorm'

export class InitialSchema1790704213716
    implements MigrationInterface {
    name =
        'InitialSchema1790704213716'

    public async up(
        queryRunner: QueryRunner
    ): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "products" (
                "id" BIGSERIAL NOT NULL,
                "name" character varying(255) NOT NULL,
                "description" text NOT NULL,
                "price_cents" integer NOT NULL,
                "stock" integer NOT NULL,
                "created_at"
                    TIMESTAMP WITH TIME ZONE
                    NOT NULL
                    DEFAULT now(),

                "search_vector" tsvector
                    GENERATED ALWAYS AS (
                        to_tsvector(
                            'simple',
                            "name" || ' ' || "description"
                        )
                    ) STORED,

                CONSTRAINT "CHK_products_price_cents"
                    CHECK ("price_cents" >= 0),

                CONSTRAINT "CHK_products_stock"
                    CHECK ("stock" >= 0),

                CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d"
                    PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_products_search_vector"
            ON "products"
            USING GIN ("search_vector")
        `)

        await queryRunner.query(`
            CREATE TABLE "users" (
                "id" BIGSERIAL NOT NULL,
                "name" character varying(120) NOT NULL,
                "email" character varying(255) NOT NULL,
                "created_at"
                    TIMESTAMP WITH TIME ZONE
                    NOT NULL
                    DEFAULT now(),

                CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"
                    UNIQUE ("email"),

                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"
                    PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_users_lower_email"
            ON "users" (lower("email"))
        `)

        await queryRunner.query(`
            CREATE TABLE "orders" (
                "id" BIGSERIAL NOT NULL,
                "user_id" bigint NOT NULL,
                "status" character varying(20) NOT NULL,
                "total_amount_cents" integer NOT NULL,
                "created_at"
                    TIMESTAMP WITH TIME ZONE
                    NOT NULL
                    DEFAULT now(),

                CONSTRAINT "CHK_orders_status"
                    CHECK (
                        "status" IN (
                            'pending',
                            'shipped',
                            'completed',
                            'cancelled'
                        )
                    ),

                CONSTRAINT "CHK_orders_total_amount_cents"
                    CHECK ("total_amount_cents" >= 0),

                CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f"
                    PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_orders_user_created_at"
            ON "orders" (
                "user_id",
                "created_at"
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_orders_cancelled_created_at"
            ON "orders" ("created_at" DESC)
            WHERE "status" = 'cancelled'
        `)

        await queryRunner.query(`
            CREATE TABLE "order_items" (
                "id" BIGSERIAL NOT NULL,
                "order_id" bigint NOT NULL,
                "product_id" bigint NOT NULL,
                "quantity" integer NOT NULL,
                "unit_price_cents" integer NOT NULL,

                CONSTRAINT "CHK_order_items_quantity"
                    CHECK ("quantity" > 0),

                CONSTRAINT "CHK_order_items_unit_price_cents"
                    CHECK ("unit_price_cents" >= 0),

                CONSTRAINT "PK_005269d8574e6fac0493715c308"
                    PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            ALTER TABLE "orders"
            ADD CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"
            FOREIGN KEY ("user_id")
            REFERENCES "users"("id")
            ON DELETE RESTRICT
            ON UPDATE NO ACTION
        `)

        await queryRunner.query(`
            ALTER TABLE "order_items"
            ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"
            FOREIGN KEY ("order_id")
            REFERENCES "orders"("id")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `)

        await queryRunner.query(`
            ALTER TABLE "order_items"
            ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00"
            FOREIGN KEY ("product_id")
            REFERENCES "products"("id")
            ON DELETE RESTRICT
            ON UPDATE NO ACTION
        `)
    }

    public async down(
        queryRunner: QueryRunner
    ): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "order_items"
            DROP CONSTRAINT
            "FK_9263386c35b6b242540f9493b00"
        `)

        await queryRunner.query(`
            ALTER TABLE "order_items"
            DROP CONSTRAINT
            "FK_145532db85752b29c57d2b7b1f1"
        `)

        await queryRunner.query(`
            ALTER TABLE "orders"
            DROP CONSTRAINT
            "FK_a922b820eeef29ac1c6800e826a"
        `)

        await queryRunner.query(`
            DROP TABLE "order_items"
        `)

        await queryRunner.query(`
            DROP INDEX
            "public"."idx_orders_cancelled_created_at"
        `)

        await queryRunner.query(`
            DROP INDEX
            "public"."idx_orders_user_created_at"
        `)

        await queryRunner.query(`
            DROP TABLE "orders"
        `)

        await queryRunner.query(`
            DROP INDEX
            "public"."idx_users_lower_email"
        `)

        await queryRunner.query(`
            DROP TABLE "users"
        `)

        await queryRunner.query(`
            DROP INDEX
            "public"."idx_products_search_vector"
        `)

        await queryRunner.query(`
            DROP TABLE "products"
        `)
    }
}