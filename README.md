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

Якщо товару недостатньо або користувач не має достатнього balance,
транзакція завершується rollback. Незавершені orders при цьому не залишаються.

### Race demo

Для перевірки одночасних checkout використовується:

```bash
npm run demo:race
```

Тест запускає 50 одночасних checkout при stock = 10.

Результат тесту:

```text
Attempts: 50
Successful: 10
Failed: 40
Final stock: 0
Negative stock rows: 0
Race invariant OK
```

Це показує, що oversell не відбувається навіть при великій кількості
одночасних запитів.

### Worker pool

Для post-processing використовується worker pool з:

```sql
FOR UPDATE SKIP LOCKED
```

Запуск:

```bash
npm run demo:workers
```

У тесті використовуються 3 workers та 12 jobs.

Один із фактичних результатів:

```text
Workers: 3
Jobs: 12
worker-1: 4
worker-2: 4
worker-3: 4
Done jobs: 12
Processed twice: 0
Total time: 663 ms
Sequential estimate: 1800 ms
Worker invariant OK
```

`SKIP LOCKED` дозволяє workers брати різні tasks без очікування на jobs,
які вже обробляються іншим worker.

### Transaction retry

Для помилок конкурентних транзакцій реалізовано retry всієї транзакції.

Retry виконується тільки для PostgreSQL кодів:

```text
40001
40P01
```

Це відповідно serialization failure та deadlock detected.

Інші помилки не retry-яться, тому що вони можуть бути викликані
валідацією, неправильними даними або програмною помилкою, яку повторний
запуск транзакції не виправить.

Запуск:

```bash
npm run demo:retry
```

Приклад результату:

```text
transaction-B: caught 40001, retry 1, backoff 50 ms
Total retries: 1
Expected balance: 998000
Final balance: 998000
Retry invariant OK
```

## Data layer ops

### PgBouncer

Marketplace PostgreSQL працює через PgBouncer.

Застосунок підключається до бази через:

```text
127.0.0.1:6432
```

а не напряму до PostgreSQL на порту `5432`.

Конфігурація PgBouncer знаходиться у:

```text
pgbouncer/pgbouncer.ini
```

Основні параметри:

```ini
pool_mode = transaction
default_pool_size = 5
max_client_conn = 150
```

Для адміністративної консолі налаштований:

```ini
admin_users = marketplace_user
```

Використовується `transaction` mode. У цьому режимі PostgreSQL connection
закріплюється за клієнтом тільки на час транзакції. Після завершення
транзакції connection повертається в pool і може бути використаний іншим
клієнтом.

Це дозволяє великій кількості client connections використовувати
невелику кількість реальних PostgreSQL connections.

Transaction pooling має обмеження:

- session-level `SET` параметри не гарантуються між транзакціями;
- session advisory locks не можна надійно використовувати між транзакціями;
- temporary tables, які залежать від session connection, можуть працювати не так, як очікується;
- prepared statements потребують підтримки з боку PgBouncer.

Для prepared statements налаштовано:

```ini
max_prepared_statements = 200
```

Перевірити підключення через PgBouncer можна командою:

```bash
docker exec \
  -e PGPASSWORD=marketplace_password \
  marketplace-pgbouncer \
  psql \
  -h 127.0.0.1 \
  -p 6432 \
  -U marketplace_user \
  -d marketplace \
  -c "SELECT 1;"
```

Очікуваний результат:

```text
 ?column?
----------
        1
(1 row)
```

Перевірити PgBouncer admin console:

```bash
docker exec \
  -e PGPASSWORD=marketplace_password \
  marketplace-pgbouncer \
  psql \
  -h 127.0.0.1 \
  -p 6432 \
  -U marketplace_user \
  -d pgbouncer \
  -c "SHOW POOLS;"
```

Для бази `marketplace` значення `pool_mode` повинно бути:

```text
transaction
```

### Backup

Backup створюється скриптом:

```text
scripts/backup.sh
```

Скрипт отримує `DATABASE_URL` з process environment.

Основний спосіб запуску:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
```

Для grader без доступу до secret storage використовується:

```bash
export DATABASE_URL=postgresql://marketplace_user:marketplace_password@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
```

Backup створюється через:

```bash
pg_dump -Fc
```

Формат `-Fc` є PostgreSQL custom format і може бути відновлений через
`pg_restore`.

Backup-файли зберігаються локально у:

```text
backups/
```

Файли мають дату та час у назві.

Приклад:

```text
marketplace_2026-10-05_16-04-32.dump
```

Один із фактично створених backup мав розмір:

```text
18742 bytes
```

Папка `backups/` не зберігається у Git.

### Backup schedule

Cron-розклад знаходиться у:

```text
backup.cron
```

Використовується нічний backup:

```cron
0 2 * * * bash scripts/with-secrets.sh dev bash scripts/backup.sh >> backups/backup.log 2>&1
```

Backup запускається щодня о `02:00`.

### Restore drill

Restore drill знаходиться у:

```text
scripts/restore-drill.sh
```

Запуск:

```bash
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Скрипт автоматично:

1. знаходить останній `.dump` у папці `backups/`;
2. отримує контрольне значення з робочої бази;
3. видаляє старий restore-container та restore-volume, якщо вони існують;
4. створює новий порожній Docker volume;
5. запускає чистий PostgreSQL container;
6. відновлює backup через `pg_restore --no-owner --no-privileges`;
7. отримує контрольне значення з відновленої бази;
8. порівнює значення до та після restore;
9. друкує `MATCH`, якщо дані співпадають;
10. видаляє тимчасовий container та volume.

Для перевірки використовується таблиця `orders`.

Контрольне значення складається з:

```sql
SELECT
    COUNT(*)::text
    || '|'
    || COALESCE(
        SUM(total_amount_cents),
        0
    )::text
FROM orders;
```

Під час фактичного restore drill було отримано:

```text
Source control: 5|728900
Restored control: 5|728900
```

Результат:

```text
MATCH
```

Restore drill був успішно виконаний два рази поспіль.

Виміряний час:

```text
Run 1: 4 seconds
Run 2: 3 seconds
```

### RTO

RTO — час, необхідний для відновлення бази після збою.

Для поточного dev-набору даних виміряний RTO:

```text
approximately 4 seconds
```

### RPO

Backup виконується один раз на добу.

Тому максимальний RPO:

```text
up to 24 hours
```

У найгіршому випадку між останнім backup та аварією може бути втрачено
до 24 годин нових даних.

Детальний протокол restore drill знаходиться у:

```text
RESTORE-DRILL.md
```

## Grading

Для перевірки на свіжому clone:

```bash
docker compose up -d --wait
export DATABASE_URL=postgresql://marketplace_user:marketplace_password@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Для повної перевірки проєкту також можна виконати:

```bash
npm ci
npm run build
npx tsc --noEmit
npm run migrate
npm run seed
```

Перевірка PgBouncer configuration:

```bash
grep -E '^[[:space:]]*pool_mode[[:space:]]*=[[:space:]]*transaction' pgbouncer/pgbouncer.ini
```

Перевірка connection contract:

```bash
grep -E '^(export[[:space:]]+)?(DATABASE_URL|DB_URL)=' .env.example
```

Перевірка cron:

```bash
grep -cE '^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|([0-9*/,-]+[[:space:]]+){4}[0-9*/,-]+)[[:space:]]+.*backup' backup.cron
```

Перевірка RTO/RPO:

```bash
grep -iE 'RTO|RPO' RESTORE-DRILL.md
```

## Testing

The project has three test layers:

- integration tests against a real PostgreSQL container;
- E2E tests against the full Nest application;
- Pact consumer/provider contract tests.

### Integration tests

Run:

```bash
npm run test:integration
```
