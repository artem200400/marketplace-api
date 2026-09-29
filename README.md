# Marketplace API

A small marketplace API described with OpenAPI 3.0.3.

The project uses **Option B: runtime contract validation** with
`express-openapi-validator`.

## Resources

The API contains two main resources:

- Products
- Orders

Available operations:

- `GET /products`
- `GET /products/{id}`
- `GET /orders`
- `POST /orders`
- `GET /orders/{id}`

## OpenAPI contract

The API contract is located at:

```text
openapi/openapi.yaml
```

## TypeORM and database

The project uses TypeORM with PostgreSQL.

Database schema changes are managed only through migrations.

`synchronize` is disabled:

```ts
synchronize: false;
```

## Конкурентність

### Transactional checkout

Checkout виконується в одній транзакції:

1. атомарно зменшується stock товару;
2. атомарно списується balance користувача;
3. створюється order;
4. створюється order item;
5. у `job_queue` додається задача для post-processing.

Для захисту від oversell використовується атомарний SQL:

```sql
UPDATE products
SET stock = stock - $1
WHERE id = $2
  AND stock >= $1
RETURNING id, price_cents, stock;
```
