INSERT INTO users (
    name,
    email,
    created_at
)
SELECT
    'Користувач ' || gs,
    'user' || gs || '@example.com',
    now() - ((gs % 1000) || ' hours')::interval
FROM generate_series(1, 20000) AS gs;


INSERT INTO products (
    name,
    description,
    price,
    stock,
    created_at
)
SELECT
    CASE
        WHEN gs % 50 = 0 THEN
            'Шкіряні кросівки модель ' || gs

        WHEN gs % 100 = 1 THEN
            'Засоби для догляду за кросівок ' || gs

        WHEN gs % 5 = 0 THEN
            'Ноутбук для роботи ' || gs

        WHEN gs % 5 = 1 THEN
            'Міський рюкзак ' || gs

        WHEN gs % 5 = 2 THEN
            'Бездротові навушники ' || gs

        WHEN gs % 5 = 3 THEN
            'Спортивна сумка ' || gs

        ELSE
            'Смартфон модель ' || gs
    END,

    CASE
        WHEN gs % 50 = 0 THEN
            'Зручні шкіряні кросівки для міста та щоденного використання'

        WHEN gs % 100 = 1 THEN
            'Товари для очищення та догляду за кросівок після використання'

        WHEN gs % 5 = 0 THEN
            'Потужний ноутбук для навчання роботи та програмування'

        WHEN gs % 5 = 1 THEN
            'Практичний український рюкзак для міста та подорожей'

        WHEN gs % 5 = 2 THEN
            'Навушники з якісним звуком для музики та дзвінків'

        WHEN gs % 5 = 3 THEN
            'Містка спортивна сумка для тренувань'

        ELSE
            'Сучасний смартфон для щоденного використання'
    END,

    (
        1000 + (gs % 50000)
    )::numeric / 100,

    gs % 250,

    now() - ((gs % 720) || ' hours')::interval

FROM generate_series(1, 120000) AS gs;


INSERT INTO orders (
    user_id,
    status,
    total_amount,
    created_at
)
SELECT
    ((gs * 17) % 20000) + 1,

    CASE
        WHEN gs % 100 < 65 THEN
            'completed'
        WHEN gs % 100 < 85 THEN
            'shipped'
        WHEN gs % 100 < 97 THEN
            'pending'
        ELSE
            'cancelled'
    END,

    (
        2000 + (gs % 500000)
    )::numeric / 100,

    now()
        - ((gs % 365) || ' days')::interval
        - ((gs % 24) || ' hours')::interval

FROM generate_series(1, 150000) AS gs;


INSERT INTO order_items (
    order_id,
    product_id,
    quantity,
    unit_price
)
SELECT
    o.id,
    p.id,
    ((o.id + item_number) % 3) + 1,
    p.price
FROM orders o
CROSS JOIN generate_series(1, 2) AS item_number
JOIN products p
    ON p.id =
        (
            (
                o.id * 13 + item_number
            ) % 120000
        ) + 1;


VACUUM (ANALYZE);