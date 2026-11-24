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

### HW26 Grading

```bash
docker compose up -d --wait

export STORAGE_ENDPOINT=http://127.0.0.1:22650
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass
export STORAGE_BUCKET=hw26-files
export STORAGE_REGION=us-east-1
export STORAGE_PRESIGNED_TTL=120
export SKIP_VAULT=1

npm ci
npx tsc --noEmit

npm run demo:upload
npm run demo:multipart
npm run demo:multipart
npm run demo:cdn
```

Static wrapper check:

```bash
node -e "const s=require('./package.json').scripts;const need=['demo:upload','demo:multipart','demo:cdn'];const bad=need.filter(k=>/with-secrets\\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"
grep -q 'SKIP_VAULT' scripts/with-secrets.sh && echo "аварійний вхід є"
```


### HW29 Grading

```bash
docker compose up -d --wait

export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:22918
export PROMETHEUS_URL=http://127.0.0.1:22901
export TRACE_API_URL=http://127.0.0.1:22904
export GRAFANA_ADMIN_USER=admin
export GRAFANA_ADMIN_PASSWORD=admin
export SKIP_VAULT=1

npm ci
npx tsc --noEmit

npm run demo:logs
npm run demo:metrics
npm run demo:trace
```

Static wrapper check:

```bash
node -e "const s=require('./package.json').scripts;const need=['demo:logs','demo:metrics','demo:trace'];const bad=need.filter(k=>/with-secrets\\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"
ROOT=$(git rev-parse --show-toplevel); WS=$(git -C "$ROOT" ls-files '*with-secrets.sh' | head -1)
echo "обгортка=${WS:-НЕМАЄ}"
grep -qs 'SKIP_VAULT' "$ROOT/$WS" && echo "аварійний-вхід=1" || echo "аварійний-вхід=0"
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

## Trade-offs: WebSocket vs SSE

For order status notifications, I would keep SSE in production when the client only needs server-to-client notifications. It is simpler to reconnect and easier to operate through regular HTTP infrastructure. I would choose WebSocket when the application needs frequent bidirectional realtime communication.

| Criterion      | WebSocket                                    | SSE                                     |
| -------------- | -------------------------------------------- | --------------------------------------- |
| Direction      | Bidirectional: client and server             | Server to client only                   |
| Reconnect      | Handled by Socket.IO client logic            | Native reconnect with Last-Event-ID     |
| Infrastructure | Requires WebSocket-aware proxy/load balancer | Works over normal HTTP                  |
| Missed events  | Requires custom replay logic                 | Last-Event-ID supports replay naturally |
| Cost per event | Very low after connection is established     | Small text event over open HTTP stream  |

Run the WebSocket isolation demo:

```bash
node scripts/realtime-demo.mjs
echo "exit=$?"
```

## Async-події через RabbitMQ

Marketplace API використовує RabbitMQ для асинхронної доставки доменних подій.

Подія:

```text
order.placed
```


## Redis: кеш, сесії, ліміти, черга

HW23 використовує два незалежні Redis-інстанси.

- `redis-cache` — тільки кеш, з обмеженим `maxmemory` і політикою `allkeys-lru`.
- `redis-queue` — BullMQ, session/token state та shared rate-limit, з `maxmemory-policy noeviction` і AOF `everysec`.

Два інстанси потрібні тому, що кеш може безпечно втрачати старі ключі через eviction, а queue/session/rate-limit state не повинен випадково зникати через LRU.

### Cache-aside і stampede protection

Кеш працює за схемою cache-aside: Redis -> при miss single-flight lock через `SET NX PX` -> PostgreSQL -> Redis.

Кожен ключ має TTL з jitter:

```text
300 + random(0..60) seconds
```

Лок знімається тільки власником через Lua compare-and-delete.

Якщо stampede-lock зламається, коректність бізнес-стану не порушиться: кілька запитів можуть зайвий раз прочитати однакові дані з PostgreSQL. Це лише зайва робота, тому тут lock є оптимізацією, а не захистом бізнес-інваріанта.

### Sessions

Session state зберігається у `redis-queue`, а не в cache Redis. Rolling TTL продовжується при активності через `GETEX`, тому активна сесія переживає рестарт API-процесу і не залежить від його пам'яті.

### Rate limit

Використовується shared sliding-window limiter. Два незалежні instances працюють з одним Redis state. Cleanup/count/add виконуються атомарно одним Lua-скриптом. Перевищення дає семантику HTTP `429` і `Retry-After`.

### BullMQ

BullMQ використовує окремий Redis з `noeviction`.

Failing job має щонайменше 3 attempts та exponential backoff з jitter. Два `add` з однаковим custom `jobId` залишають одну задачу. `removeOnComplete: true` не використовується, щоб completed job продовжував захищати від duplicate jobId.

Періодична задача створюється через `upsertJobScheduler`, тому повторний startup не плодить duplicate scheduler.

### HW23 demo

```bash
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
```

Очікувані інваріанти:

```text
cache-lru=1
cache-maxmemory=1
warmed>=50
ttl-distinct>=5
concurrent>=20
db-calls=1
db-calls-warm=0

requests>=3
sessions=1
in-redis=1
ttl-renewed=1

instances>=2
allowed=limit
blocked>=1
status=429
retry-after=1

queue-noeviction=1
attempts>=3
completed=1
added=2
queued=1
schedulers>=1
scheduled-runs>=2
```

### HW23 Grading

На свіжому clone:

```bash
docker compose up -d --wait

export REDIS_URL=redis://127.0.0.1:6381
export REDIS_QUEUE_URL=redis://127.0.0.1:6382
export DATABASE_URL=postgresql://marketplace_user:marketplace_password@127.0.0.1:6432/marketplace
export SKIP_VAULT=1

npm ci
npx tsc --noEmit

npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue
```


## Files

HW26 використовує локальний MinIO як S3-сумісне object storage. AWS-акаунт і картка для локального стенда не потрібні.

| Змінна | Приклад для локального стенда | Джерело |
| --- | --- | --- |
| `STORAGE_ENDPOINT` | `http://127.0.0.1:22650` | environment / secret wrapper |
| `STORAGE_ACCESS_KEY` | `hw26user` | secret storage; для локального compose значення dev-only |
| `STORAGE_SECRET_KEY` | `hw26secretpass` | secret storage; для локального compose значення dev-only |
| `STORAGE_BUCKET` | `hw26-files` | environment |
| `STORAGE_REGION` | `us-east-1` | environment, optional |
| `STORAGE_PRESIGNED_TTL` | `120` | environment, optional |

### Upload contract

Завантаження двокрокове:

1. `POST /uploads/intent` генерує server-side key виду `uploads/{userId}/{uuid}.{ext}`.
2. Клієнт робить PUT напряму в object storage через presigned URL.
3. `POST /uploads/commit` виконує `HeadObject` і тільки після перевірки переводить запис у `COMPLETED`.

Клієнтський filename не потрапляє у key. Розширення вибирається тільки за allowlist `Content-Type`.

Presigned TTL для форми завантаження — 120 секунд. Для avatar/product form цього достатньо, але URL не живе довго після того, як користувач покинув форму. Presigned URL не можна відкликати окремо, тому короткий TTL є частиною моделі безпеки.

### Multipart

Для multipart використовується мінімум 5 MiB на частину, preferred size 8 MiB і обмеження S3 у 10 000 частин:

```text
partSize = max(5 MiB, 8 MiB, ceil(fileSize / 10000))
```

Resume робиться через `ListParts`: новий процес бачить уже завантажені part numbers і підписує/довантажує тільки відсутні.

Demo навмисно ріже файл приблизно на три частини, завантажує перші дві, потім resume додає рівно одну. До `CompleteMultipartUpload` `HeadObject` повертає 404; після complete розмір збігається, а ETag має multipart-суфікс `-N`.

### CDN / edge

Для локальної здачі вибрана форма **private MinIO + локальний edge**.

Bucket не має anonymous read. Публіка ходить тільки в edge. Edge читає MinIO своїми credentials, кешує об'єкт і повертає `X-Cache: MISS` або `X-Cache: HIT`.

Публічні assets мають content hash у назві:

```text
assets/app.<sha256-8>.css
```

і завантажуються з:

```text
Cache-Control: public, max-age=31536000, immutable
```

Після нового deploy змінюється URL, тому invalidation не потрібен.

AWS CloudFront + OAC bucket policy для production-варіанту:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
        }
      }
    }
  ]
}
```

### Demo contract

```text
demo:upload
intent=200
key-from-server=1
api-alive=0
put-offline=200
commit=200
commit-without-bytes=409
tampered=403
expired=403

demo:multipart
head-before-complete=404
resumed-parts=1
complete=200
size-match=1
etag-multipart=1

demo:cdn
direct=403
edge-miss=200
edge-hit=200
cache-hit=1
new-name=1
new-url=200
content-changed=1
```

Кожен demo очищає bucket на старті/виході. Multipart cleanup також abort-ить незавершені uploads.

Для production варто додати lifecycle `AbortIncompleteMultipartUpload` приблизно через 7 днів і фонову BullMQ job, яка прибирає старі `PENDING` записи/об'єкти.


## Kubernetes

HW28 розгортає production-образ Marketplace API у локальному одновузловому кластері **kind**. Кластер працює в Docker Desktop; локально Docker Desktop має **7.609 GiB Total Memory**, окремий ліміт пам'яті на сам kind-кластер не задається.

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `APP_DB_PASSWORD` | сховище (#11) | runtime secret, створюється як Kubernetes Secret і підключається через `secretKeyRef` |
| `PULUMI_CONFIG_PASSPHRASE` | локальний grading environment | шифрування локального Pulumi state |
| `PULUMI_BACKEND_URL` | локальний grading environment | файловий backend Pulumi без cloud login |
| `APP_IMAGE` | environment, optional | тег production image; default `marketplace-api:hw28` |
| `REV` | environment, optional | зміна pod template для контрольованого rollout |

Production image збирається multi-stage Dockerfile. Build secret передається тільки через BuildKit `RUN --mount=type=secret`; файл `.npm_token` не копіюється в build context як runtime secret і доданий у `.gitignore`. Фінальний image — distroless Node.js, запускається numeric UID `65532` і не містить shell.

### Probes і graceful shutdown

Readiness і liveness мають різні URL:

- readiness: `/readyz`;
- liveness: `/healthz`.

Застосунок має приблизно 4 секунди warm-up перед `listen()`. На `SIGTERM` він спочатку робить readiness червоним, потім чекає 5 секунд на drain і лише після цього закриває Nest application. `terminationGracePeriodSeconds=12`, тобто Kubernetes не посилає SIGKILL раніше завершення drain.

RollingUpdate використовує:

```text
maxUnavailable=0
maxSurge=1
```

Тому старий pod не забирається з доступного набору, поки новий не став Ready.

### PDB

Deployment має 3 replicas, а PodDisruptionBudget — `minAvailable=2`. Це залишає рівно одну дозволену добровільну disruption: перше Eviction API виселення проходить, друге блокується з HTTP 429, доки бюджет не відновиться.

### HPA

HPA оголошено через `autoscaling/v2`:

```text
minReplicas=2
maxReplicas=5
CPU target=70%
```

У стандартному kind немає metrics-server, тому CPU target може показувати `<unknown>` — це очікувано. `spec.replicas=3` залишено для локального старту. У production-кластері з metrics-server одночасне керування `spec.replicas` через Pulumi і HPA створює конфлікт володіння полем; там replicas треба передати HPA або ігнорувати зміни цього поля в IaC.

### Runtime secrets

Pulumi вимагає `APP_DB_PASSWORD` до будь-якого звернення до Kubernetes API. Значення з environment створює K8s Secret, а Deployment містить лише `secretKeyRef`, не саме значення.

Для production замість передачі секрету через локальну обгортку логічні два шляхи:

- **External Secrets Operator (ESO)** — синхронізує зовнішнє secret storage у Kubernetes Secret;
- **Secrets Store CSI Driver** — монтує секрети з зовнішнього сховища у pod без ручного копіювання в manifest.

### HW28 demos

```bash
npm run demo:image
npm run demo:rollout
npm run demo:pdb
```

Контракт:

```text
demo:image
stages>=2
shell-inside=0
runtime-uid!=0
token-in-history=0
token-in-config=0
token-in-layers=0

demo:rollout
profile=correct
requests>=5000
failed=0

demo:pdb
healthy>=3
minAvailable=2
evict-1=201
evict-2=429
```

### HW28 Grading

```bash
export SKIP_VAULT=1
export APP_DB_PASSWORD=grader-secret
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"  # scripts normalize Git Bash/Windows paths
export PULUMI_CONFIG_PASSPHRASE=hw28-grading
export APP_IMAGE=marketplace-api:hw28

npm ci
npm --prefix infra ci
npx tsc --noEmit
(cd infra && npx tsc --noEmit)

printf 'dummy-npm-token' > .npm_token

npm run image:build
npm run demo:image

SCAN_MAX=-1 npm run scan || true
SCAN_MAX=99999 npm run scan

npm run cluster:up
npm run up

kubectl -n marketplace-hw28 get deploy marketplace-api
kubectl -n marketplace-hw28 get pdb marketplace-api
kubectl -n marketplace-hw28 get hpa marketplace-api

npm run demo:rollout
kubectl -n marketplace-hw28 get pdb marketplace-api -o jsonpath='{.status.disruptionsAllowed}{"\n"}'
npm run demo:pdb

npm run destroy
npm run cluster:down
```


## Observability

HW29 додає корельовані структурні логи, RED-метрики і tracing для Marketplace API. Усі три сигнали використовують один W3C `traceparent`, тому `trace_id` у логах і спанах однаковий.

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | сховище (#11) | endpoint приймача трейсів, локально `http://127.0.0.1:22918` |
| `PROMETHEUS_URL` | сховище (#11) | адреса Prometheus, локально `http://127.0.0.1:22901` |
| `TRACE_API_URL` | сховище (#11) | API для читання локальних trace-ів, `http://127.0.0.1:22904` |
| `GRAFANA_ADMIN_USER` | сховище (#11) | локальний Grafana admin user |
| `GRAFANA_ADMIN_PASSWORD` | сховище (#11) | локальний Grafana admin password |

### Logs and correlation

Request context живе в `AsyncLocalStorage`. У ньому зберігаються `trace_id`, `span_id`, optional `userId`, `tenant` та `idempotencyKey`. Бізнес-функції не приймають request заради логування.

Запит `/observe/:id` проходить щонайменше три логічні шари:

- `observe.controller`;
- `observe.service`;
- `observe.repo`.

Authorization, body, password, access/refresh tokens редагуються до запису JSON-логу. Вхідний `traceparent` продовжується замість генерації окремого correlation UUID.

### RED metrics

`GET /metrics` віддає Prometheus text exposition.

Counter:

```text
marketplace_http_requests_total{method,route,status}
```

Histogram:

```text
marketplace_http_request_duration_seconds{method,route,status}
```

`route` нормалізований. Наприклад, `/observe/42` і `/observe/999` обидва стають `/observe/:id`, тому різні id не створюють нові series.

Скінченні histogram buckets:

```text
0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 seconds
```

Верхній bucket 10 s навмисно значно більший за очікувану тривалість локального demo-запиту; `above-top-bucket=0` перевіряється самим demo.

### Grafana RED dashboard

Dashboard лежить у:

```text
observability/grafana/dashboards/marketplace-observability.json
```

Панелі відповідають на три RED-питання.

Request rate:

```promql
sum(rate(marketplace_http_requests_total[1m])) by (route)
```

5xx errors:

```promql
sum(rate(marketplace_http_requests_total{status=~"5.."}[1m])) by (route)
```

p95 duration:

```promql
histogram_quantile(
  0.95,
  sum(rate(marketplace_http_request_duration_seconds_bucket[1m])) by (le, route)
)
```

Prometheus provisioned у Grafana автоматично. Локальні порти: Grafana `22900`, Prometheus `22901`, trace ingest `22918`, trace query API `22904`.

### HW29 demos

```bash
npm run demo:logs
npm run demo:metrics
npm run demo:trace
```

Контракт:

```text
demo:logs
non-json-lines=0
layers>=3
distinct-trace-ids=1
trace-id-matches-header=1
burst>=8
burst-trace-ids=burst
burst-uneven=0
secret-req-logged=1
secret-in-logs=0

demo:metrics
sent-ok+sent-fail>=50
counter-delta=sent-ok+sent-fail
errors-delta=sent-fail
above-top-bucket=0
series-after=series-before

demo:trace
spans>=2
orphan-spans=0
trace-matches-header=1
trace-matches-log=1
span-status-error=1
```

Demo values не захардкоджені: вони рахуються зі структурних логів, двох scrape `/metrics` і trace receiver API.


## AWS

смуга: основна

teardown-run: PENDING — після реального `workflow_dispatch` сюди треба поставити ПЕРШИМ посиланням конкретний `https://github.com/artem200400/marketplace-api/actions/runs/<id>`.

> Live demo status (2026-11-23): base та IAM evidence зібрані. AWS поставив новий Free Plan project на account-verification hold; `EC2 RunInstances` повертає `Blocked: This account is currently blocked and not recognized as a valid account`. Paid demo resources після невдалих запусків були видалені; live ALB/failover/NAT evidence і фінальний teardown-run залишаються pending до зняття AWS hold.

region: `eu-north-1`

HW31 має два незалежні Pulumi-проєкти:

- `infra/base/` — бюджет, VPC, 2 public + 2 private subnets у двох AZ, IGW, route tables, security groups, GitHub OIDC role. У base немає RDS, ALB, NAT, EC2 або EIP.
- `infra/demo/` — короткоживучі платні ресурси: RDS Multi-AZ, ALB + EC2 `t4g.micro` target і NAT тільки коли `withNat=true`.

### Вартість

Перед live-run ставки треба ще раз звірити з AWS pricing. Нижче — контрольна таблиця зі знімка завдання від 2026-08-24 для `eu-central-1`; поточний live account працює в `eu-north-1`; місяць = 730 годин.

| Рядок | Ставка / база | 730 годин |
| --- | ---: | ---: |
| ALB | $0.02700/год | $19.71 |
| RDS PostgreSQL Multi-AZ `db.t4g.micro` | $0.03700/год | $27.01 |
| gp3 20 GiB Multi-AZ | $0.274/GiB-місяць × 20 | $5.48 |
| Public IPv4 ×2 під ALB | $0.00500/год ×2 | $7.30 |
| LCU, навчальне припущення | — | $0.29 |
| Разом | приблизно $0.08191/год | $59.79 |

Орієнтир із завдання: 4 години ≈ $0.33; одна доба ≈ $1.97. NAT у звичайному стеку вимкнений. Окреме `demo:nat` вмикає один NAT лише на короткий вимір; неповна NAT-година білиться як повна.

Якщо цей AWS account уже існував раніше і не має права на Free plan/credits, стек оплачується живими грошима з першої хвилини. AWS Organizations і Control Tower для HW31 не використовуються.

### Budget

`aws.budgets.Budget` — перший AWS resource у `infra/base/index.ts`.

- type: `COST`
- period: `MONTHLY`
- limit: `$5`
- notification: `ACTUAL`
- threshold: `20%`
- comparison: `GREATER_THAN`

`FORECASTED` навмисно не використовується. Budget є сигналом, а не автоматичним stop-механізмом; реальний stop тут — коротке життя `demo` і teardown workflow.

### Network

VPC: `10.31.0.0/16`.

Public subnets:
- `10.31.0.0/24`
- `10.31.1.0/24`

Private subnets:
- `10.31.10.0/24`
- `10.31.11.0/24`

Public route table має `0.0.0.0/0 -> IGW`. Private route table за замовчуванням не має `0.0.0.0/0`; NAT route з'являється тільки тимчасово в `demo:nat`.

ALB SG відкриває TCP/80 для Internet-facing demo. RDS SG відкриває TCP/5432 тільки від application/ALB SG, не від Internet.

### IAM + GitHub OIDC

Trust policy використовує provider `token.actions.githubusercontent.com`, audience `sts.amazonaws.com` і звужує `sub` до:

```text
repo:artem200400/marketplace-api:*
```

У permission policy немає `Action: "*"`. Дозволи згруповані за реальною потребою:

| Actions | Навіщо |
| --- | --- |
| `ec2:Create/Delete/Describe VPC, subnet, route table, IGW, SG` | створення/знесення base network і post-destroy checks |
| `ec2:Allocate/ReleaseAddress`, `Create/Delete/DescribeNatGateway` | одноразовий NAT demo та EIP cleanup |
| `elasticloadbalancing:Create/Delete/Describe*`, register/deregister target | ALB, target group, listener і health evidence |
| `rds:Create/Delete/Describe/Modify/Reboot*` | Multi-AZ instance, failover і events |
| `lambda:Create/Delete/Get/Update*` + permission/tag actions | дешевий ALB target без EC2 |
| `logs:Create/Delete/Describe/Tag*` | Lambda logging lifecycle |
| `tag:GetResources` | незалежна перевірка хвостів за Project tag |
| `iam:GetRole/GetRolePolicy/SimulatePrincipalPolicy` | evidence і позитивний/негативний IAM test |
| IAM lifecycle для OIDC/roles/policies | base може знести власну CI role |
| `budgets:Create/Delete/Describe/ModifyBudget` | $5 budget lifecycle |

`evidence:iam` перевіряє:
- дозволену дію: `ec2:DescribeVpcs` → `allowed`;
- заборонену дію: `s3:DeleteBucket` → `implicitDeny` або `explicitDeny`.

AWS access key/secret у GitHub Actions не зберігаються: teardown отримує короткоживучі credentials через GitHub OIDC. `PULUMI_ACCESS_TOKEN` потрібен лише для віддаленого state backend і не є AWS credential.

### RDS Multi-AZ

Demo використовує саме `aws.rds.Instance`, а не Multi-AZ DB cluster:

- PostgreSQL;
- `db.t4g.micro`;
- `multiAz: true`;
- gp3 20 GiB;
- `storageEncrypted: true`;
- `backupRetentionPeriod: 1`;
- `deletionProtection: false`;
- `skipFinalSnapshot: true`;
- private DB subnet group.

Порівняно зі стеком #15 RDS забирає на себе managed primary/standby replication, failover, storage і автоматичні snapshots. Він не забирає application migrations, транзакційні retry, перевірку restore-процедур і connection pooling. PgBouncer як патерн не стає непотрібним автоматично; у AWS для цього можна окремо розглядати RDS Proxy.

`demo:failover` запускає `reboot-db-instance --force-failover`, міряє AZ до/після, секунди і зберігає останній RDS event.

### ALB

ALB Internet-facing, у двох public subnets. Target — EC2 `t4g.micro` на Amazon Linux 2023; user-data піднімає HTTP server, а target group перевіряє HTTP 200. `demo:alb` записує:

```text
alb-dns=...
http-code=200
target-state=healthy
```

### NAT measurement

NAT у постійному стеку відсутній. `demo:nat`:

1. ставить `withNat=true`;
2. робить `pulumi up`;
3. фіксує час;
4. ставить `withNat=false`;
5. робить `pulumi up` і зносить NAT/EIP;
6. рахує `nat-minutes` і округлені `nat-billed-hours`.

### KMS

KMS не замінює secret storage із #11. Це нижчий шар: KMS-key може шифрувати, наприклад, `ENCRYPTION_KEY`/секрети, але керування самими значеннями, доступом і ротацією лишається задачею secret storage. Customer-managed KMS key для HW31 не створюється, щоб не залишати окремий платний ресурс.

### Pulumi state

У #28 використовувався локальний `file://` backend, який бачив тільки ноутбук. У HW31 teardown виконується на GitHub runner, тому state має бути віддалено доступним. Для основної смуги використовується Pulumi Cloud Individual; workflow читає `PULUMI_ACCESS_TOKEN` і не потребує AWS access keys.

### Evidence

Після реального `up`:

```bash
npm run evidence:base
npm run evidence:iam
npm run demo:alb
npm run demo:failover
npm run demo:nat
```

Ці команди створюють/оновлюють:

```text
evidence/base.txt
evidence/base-state.json
evidence/iam.json
evidence/iam.txt
evidence/demos.txt
```

Значення не підставляються вручну — вони читаються з Pulumi/AWS CLI.

### Teardown gate

`.github/workflows/teardown.yml` має `schedule` і `workflow_dispatch`, отримує AWS credentials через OIDC, зносить `demo`, потім `base`, після чого перевіряє вибраний project region `eu-north-1`.

У фінальному dispatch-run мають бути:

```text
state-resources-left=0
tagged-resources-left=0
rds-left=0
alb-left=0
nat-left=0
eip-left=0
```

Після успішного live teardown конкретне Actions URL треба вставити у верх цього розділу замість `PENDING`. Саме цей run є головним доказом знесення.

### HW31 local commands

```bash
export SKIP_VAULT=1
export AWS_REGION=eu-north-1
export HW31_BUDGET_EMAIL=<your-email>
export HW31_DB_PASSWORD=<temporary-rds-password>
export PULUMI_ACCESS_TOKEN=<pulumi-cloud-token>

npm --prefix infra ci

npm run up:base

# Після base up:
# 1) отримай fully-qualified base stack ref і задай:
export HW31_BASE_STACK_REF=<org>/marketplace-hw31-base/dev

# 2) додай output teardownRoleArn як GitHub repository variable:
# AWS_TEARDOWN_ROLE_ARN

npm run evidence:base
npm run evidence:iam

npm run up:demo
npm run demo:alb
npm run demo:failover
npm run demo:nat

# Не залишай paid demo після роботи:
npm run destroy:demo
```

Не запускай `up:demo`, поки не готовий одразу пройти demos і teardown.

## CI/CD

HW32 переносить перевірки з локального HW28 у GitHub Actions. Хмарний акаунт для HW32 не потрібен: PR pipeline піднімає локальний kind на GitHub-hosted runner, використовує файловий Pulumi backend і деплоїть Kubernetes ресурси через ту саму Pulumi-програму з `infra/`.

Схема PR pipeline:

```text
quality
  ├─ tsc --noEmit
  ├─ ESLint
  ├─ oasdiff breaking
  ├─ dependency-cruiser
  └─ actionlint
       ↓
build
  ├─ image build exactly once
  ├─ push to GHCR
  ├─ digest output
  └─ vulnerability scan gate
       ↓
deploy-test
  ├─ verify GitHub OIDC signature + iss/aud/sub
  ├─ kind
  ├─ pulumi preview
  ├─ cost gate
  ├─ pulumi up by exact digest
  ├─ demo:rollout (failed=0)
  └─ pipeline-evidence artifact
```

Другий workflow, `.github/workflows/hw32-deploy.yml`, запускається вручну через `workflow_dispatch` і приймає вже готові `image_ref` + `image_digest`. Він не перебудовує образ: promote відбувається за digest.

### OIDC

Політика довіри знаходиться в:

```text
oidc/policy.json
```

Гейт:

```text
scripts/oidc-gate.mjs
```

Він читає OpenID discovery document, бере `jwks_uri`, перевіряє RS256-підпис токена публічним JWK і тільки після цього звіряє `iss`, `aud`, `sub` та час дії токена. Сам JWT у лог не друкується.

Локальне `npm run demo:oidc` створює власну RSA-пару і три токени:

```text
case=green         -> sig-verified=1 policy-allow=1
case=foreign-sub   -> sig-verified=1 policy-allow=0
case=bad-signature -> sig-verified=0 policy-allow=0
```

### Quality gates

Чотири сходинки PR gate:

1. types/style: `tsc --noEmit` + ESLint;
2. contract: `oasdiff breaking`;
3. architecture: dependency-cruiser;
4. image: scanner з HW28 і порогом.

`npm run demo:gates` запускає той самий клас перевірки на коректному та навмисне зламаному вході й друкує:

```text
types-ok=0
types-broken=<non-zero>
contract-ok=0
contract-broken=<non-zero>
architecture-ok=0
architecture-broken=<non-zero>
image-ok=0
image-broken=<non-zero>
```

### Build once / promote by digest

PR workflow містить рівно один `docker buildx build`. Він пушить образ у GHCR із тегом SHA голови PR та повертає `sha256:...` через job output. Наступна job тягне саме `image-ref@digest`, вантажить байти у kind і передає той самий digest у Pulumi через `APP_IMAGE`.

Тег потрібен для читабельності, але деплой виконується за digest.

### Pipeline evidence

Кожен PR run вивантажує artifact:

```text
pipeline-evidence
```

Крок upload виконується з `if: always()`. Усередині:

```text
evidence.txt
deployment.json
plan.json
rollout.txt
build.log
```

`evidence.txt` містить `run-id`, `head-sha`, image refs/digests, OIDC claims, rollout counters, `secret-in-manifest` і exit code image scan gate. Значення рахуються з реальних файлів і outputs поточного run.

### Secrets

Секрети застосунку не використовуються під час build. Вони приходять тільки в runtime через обгортку `scripts/with-secrets.sh`.

| Змінна | Джерело | Використання |
| --- | --- | --- |
| `APP_DB_PASSWORD` | сховище секретів із HW11; у grader/CI передається через export при `SKIP_VAULT=1` | Kubernetes Secret через `secretKeyRef` |

Pipeline не має довгоживучого cloud credential або registry password. GHCR використовує короткоживучий `GITHUB_TOKEN`, який GitHub видає для конкретного run; OIDC token теж видається тільки job із `id-token: write`.

| Pipeline secret | Де береться | Навіщо |
| --- | --- | --- |
| custom repository secrets | немає | HW32 не потребує AWS/GCP/Azure key |
| `GITHUB_TOKEN` | автоматичний GitHub runtime token, не repository secret | GHCR push/pull |

Межа masking: маскування GitHub не вважається захистом. Workflow не робить `echo "$SECRET"`, `env`, `printenv` або `set -x` у кроках, що бачать credential. Секрет не повинен потрапляти в лог навіть у перекодованому чи частково зміненому вигляді.

### Cost gate

`src/mapping.ts` читає Pulumi `plan.json` і переводить CPU/memory requests Kubernetes Deployment у місячну оцінку. Для навчальної оцінки використані on-demand ставки GKE Autopilot general-purpose:

| Ресурс | Ставка |
| --- | ---: |
| vCPU | $0.0445 / vCPU-hour |
| Memory | $0.0049225 / GiB-hour |
| Month | 730 hours |

Джерело: https://cloud.google.com/kubernetes-engine/pricing

Гейт запускається через:

```bash
PLAN_JSON=/tmp/hw32/plan.json COST_BUDGET_USD=10 npm run gate:cost
```

Він друкує `budget-usd`, `plan-usd`, `gate=pass|fail` і повертає ненульовий exit code, якщо бюджет перевищено.

cost-gate-bypass-label: cost-approved

### HW32 Grading

```bash
git clone <repository> && cd <repository>
git checkout hw-32
npm ci

export SKIP_VAULT=1
export APP_DB_PASSWORD=grader-secret

npm run demo:gates
npm run demo:oidc

PLAN_JSON=/tmp/hw32/plan.json COST_BUDGET_USD=0 npm run gate:cost
# expected: gate=fail and non-zero exit

PLAN_JSON=/tmp/hw32/plan.json COST_BUDGET_USD=999999 npm run gate:cost
# expected: gate=pass and exit 0
```

Локальні `demo:gates` і `demo:oidc` не ходять у GitHub і не потребують Kubernetes cluster. `gate:cost` читає `plan.json` із завантаженого `pipeline-evidence`.


---

## Coursework — final project acceptance

### Business domain and architectural record

**Marketplace order processing.** The primary business scenario is placing an order, delivering
an `order.placed` message to RabbitMQ, processing it exactly once at the database effect level,
and reading `completed` via an independent GET request. NestJS remains the HTTP application
framework. PostgreSQL is the durable source of truth.

| Domain suitability test | Evidence | Result |
| --- | --- | --- |
| Core business entity | Order with items and status | Yes |
| State transitions | pending → completed by asynchronous consumer | Yes |
| Concurrency | Transactional checkout + `demo:race` | Yes |
| External integration | RabbitMQ and HTTP API | Yes |
| Data invariants | SQL constraints and migration-managed schema | Yes |
| Background work | Polling outbox relay and RabbitMQ consumer | Yes |
| Meaningful tests | Docker acceptance and testcontainers suites | Yes |

```mermaid
flowchart LR
  Client[HTTP client] --> Controller[NestJS OrdersController]
  Controller --> Service[Order creation service]
  Service --> DB[(PostgreSQL: orders + outbox)]
  DB --> Relay[Outbox polling relay]
  Relay --> MQ[RabbitMQ]
  MQ --> Consumer[NestJS consumer]
  Consumer --> DB
  Client -->|GET order by id| Controller
  Service --> Logs[JSON logs and HTTP metrics]
```

**Trade-offs.** We choose polling outbox because it can be verified against PostgreSQL without
deploying CDC; Debezium could reduce polling later at greater infrastructure cost.
We choose `FOR UPDATE SKIP LOCKED` to let multiple relay workers proceed without waiting,
but delivery order is not globally guaranteed.
We choose at-least-once broker delivery with a unique event-effect record instead of assuming
exactly-once delivery across two resource managers. A crash after publish may redeliver;
the consumer deduplicates and transitions the order in one database transaction.

**Decision log.** Early homework introduced OpenAPI and a simple API. Later steps added
PostgreSQL migrations, guarded checkout, PgBouncer, Redis, RabbitMQ, files, metrics, Kubernetes,
AWS infrastructure examples, and GitHub workflows. The final project links the previously
separate checkout, broker, and status-reading exercises with a transactional outbox and
a live acceptance test.

### Reproducible local run

Prerequisites: Docker Compose, Node.js 22, npm, Docker daemon. Use only local demo
credentials supplied by the Compose file; do not expose its ports publicly or reuse
these passwords in production.

```bash
npm ci
docker compose -f docker-compose.yml -f compose.coursework.yml up -d --wait api
export DATABASE_URL=postgresql://marketplace_user:marketplace_password@127.0.0.1:6432/marketplace
node scripts/coursework-smoke.mjs
```

The Compose API service builds, migrates, seeds and starts the NestJS service automatically.
It listens at `http://127.0.0.1:23000` (Docker maps host 23000 to container 3000).
`GET /healthz` is liveness and `GET /readyz` is readiness; `GET /metrics` provides metrics.
`POST /orders` requires the `Idempotency-Key` header and an `items` array, while
`GET /orders/:id` returns the persisted status. Register through `POST /auth/register`,
login with `POST /auth/login`, and pass the returned access token as
`Authorization: Bearer <token>`. Refresh rotation happens at `POST /auth/refresh`;
`POST /auth/logout` revokes the current session. The demo Compose generates
`AUTH_JWT_SECRET` randomly on startup (never commit real signing keys). A separate RabbitMQ process and an
outbox relay are used for asynchronous completion.

On a successful acceptance run the script prints:
```text
requests=2
orders=1
published=1
effect=1
final-status=completed
coursework-smoke=PASS
```

These are **expected assertions**, not a claim that every CI run has passed.
The script exits nonzero if any assertion fails and checks the real PostgreSQL database.

Stop the local stack:
```bash
docker compose -f docker-compose.yml -f compose.coursework.yml down
```

### Coursework evidence and testing

Run `npm run test:integration`, `npm run test:e2e`, `npm run test:contract`,
`npm run demo:race`, `npm run demo:logs`, `npm run demo:metrics`, and
`node scripts/coursework-smoke.mjs` as appropriate. The GitHub
`Coursework acceptance` workflow runs TypeScript checking and the live Docker smoke test.
See other README sections for earlier homework-specific demos.

| Scoring block | Path | Evidence / limitations |
| --- | --- | --- |
| Architecture | Course + extension | This section, NestJS controllers, order service and SQL repository access |
| Business flow / API | Course + extension | POST/GET live smoke, `demo:race`, OpenAPI contract; compare response schema before grading |
| Persistence | Course | TypeORM migrations, Postgres, PgBouncer, backup/restore demo |
| Security | Course + extension | Password hashing, HS256 allowlist, short-lived access tokens, persistent refresh sessions, refresh-family reuse revocation, 401/403 ownership and admin guard; see smoke |
| Background work | Course + extension | RabbitMQ, transactional outbox, consumer deduplication, completed order status |
| Docker / deployment | Course + extension | Local Compose service, earlier Docker/Kubernetes and GitHub deployment artifacts; public deployment not claimed |
| Observability / CI | Course | `/healthz`, `/readyz`, `/metrics`, JSON logging, test suites, live smoke workflow |

**Remaining gaps:** the API error envelope is not yet uniformly `application/problem+json`,
and the checkout path must still receive a complete production security review before
public deployment. Authorization applies to order creation, reading, SSE and status mutation.
Tokens are issued only from authenticated identities, not a user-supplied identity header.
The existing filesystem/object storage and Kubernetes demos are separate from the main business contour.

### Environment variable sources

| Variable | Local development source | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | Runtime-generated random secret in demo; secret manager in production | HMAC signing key (32+ bytes) |
| `PORT` | `compose.coursework.yml` | API port |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Compose environment | Database endpoint |
| `DB_PASSWORD_FILE` | Local temporary file generated at container startup | Database password file |
| `DB_URL`, `DATABASE_URL` | Compose environment / external secret provider | Database connection for migrations and demos |
| `BROKER_URL` | Compose environment / external secret provider | RabbitMQ |
| `SKIP_VAULT` | Compose local-only grading override | Bypass dev Infisical |
| `APP_WARMUP_MS`, `APP_DRAIN_MS` | Compose environment | Controlled lifecycle |

Production values must be injected through a secrets manager or runtime secret mounts, not
the checked-in local Compose defaults. Rotate any exposed credentials before external deployment.
