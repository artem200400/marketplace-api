DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(120) NOT NULL,
    email varchar(255) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(255) NOT NULL,
    description text NOT NULL,
    price numeric(12, 2) NOT NULL CHECK (price >= 0),
    stock integer NOT NULL CHECK (stock >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),

    search_vector tsvector
        GENERATED ALWAYS AS (
            to_tsvector(
                'simple',
                name || ' ' || description
            )
        ) STORED
);

CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id bigint NOT NULL
        REFERENCES users(id),

    status varchar(20) NOT NULL
        CHECK (
            status IN (
                'pending',
                'shipped',
                'completed',
                'cancelled'
            )
        ),

    total_amount numeric(12, 2) NOT NULL
        CHECK (total_amount >= 0),

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    order_id bigint NOT NULL
        REFERENCES orders(id)
        ON DELETE CASCADE,

    product_id bigint NOT NULL
        REFERENCES products(id),

    quantity integer NOT NULL
        CHECK (quantity > 0),

    unit_price numeric(12, 2) NOT NULL
        CHECK (unit_price >= 0)
);