# Database optimizations

The database contains realistic marketplace data:

- 20,000 users
- 120,000 products
- 150,000 orders
- 300,000 order items

All queries were tested with:

```sql
EXPLAIN (ANALYZE, BUFFERS)
```

The first measurements were taken before applying `db/indexes.sql`.
The second measurements were taken after creating the indexes and running `ANALYZE`.

---

# Q1 — Orders by user and period

The query searches for orders belonging to one user during a selected period.

## Before

```text
Gather Merge  (cost=4114.73..4114.96 rows=2 width=31) (actual time=6.118..7.883 rows=3 loops=1)
  Workers Planned: 1
  Workers Launched: 1
  Buffers: shared hit=1387
  ->  Sort  (cost=3114.72..3114.72 rows=2 width=31) (actual time=4.060..4.061 rows=2 loops=2)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1387
        Worker 0:  Sort Method: quicksort  Memory: 25kB
        ->  Parallel Seq Scan on orders  (cost=0.00..3114.71 rows=2 width=31) (actual time=0.729..3.967 rows=2 loops=2)
              Filter: ((user_id = 42) AND (created_at >= (now() - '180 days'::interval)))
              Rows Removed by Filter: 74998
              Buffers: shared hit=1350
Planning:
  Buffers: shared hit=100
Planning Time: 0.644 ms
Execution Time: 7.945 ms
```

Before optimization PostgreSQL used a `Parallel Seq Scan` and inspected almost the whole `orders` table.

## After

```text
Sort  (cost=19.93..19.94 rows=4 width=31) (actual time=0.072..0.073 rows=3 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=9 read=3
  ->  Bitmap Heap Scan on orders  (cost=4.47..19.89 rows=4 width=31) (actual time=0.042..0.054 rows=3 loops=1)
        Recheck Cond: ((user_id = 42) AND (created_at >= (now() - '180 days'::interval)))
        Heap Blocks: exact=3
        Buffers: shared hit=6 read=3
        ->  Bitmap Index Scan on idx_orders_user_created_at  (cost=0.00..4.46 rows=4 width=0) (actual time=0.033..0.033 rows=3 loops=1)
              Index Cond: ((user_id = 42) AND (created_at >= (now() - '180 days'::interval)))
              Buffers: shared hit=3 read=3
Planning:
  Buffers: shared hit=135 read=2
Planning Time: 0.677 ms
Execution Time: 0.144 ms
```

The optimizer now uses `idx_orders_user_created_at`.
The sequential scan disappeared and only a few heap/index pages are read.

Execution time changed from approximately **7.945 ms** to **0.144 ms**.

---

# Q2 — Cancelled orders in a period

The query returns recent cancelled orders ordered by creation time.

## Before

```text
Limit  (cost=4140.48..4151.98 rows=100 width=30) (actual time=6.988..8.703 rows=100 loops=1)
  Buffers: shared hit=1387
  ->  Gather Merge  (cost=4140.48..4217.99 rows=674 width=30) (actual time=6.987..8.692 rows=100 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=1387
        ->  Sort  (cost=3140.47..3142.15 rows=674 width=30) (actual time=4.843..4.848 rows=86 loops=2)
              Sort Key: created_at DESC
              Sort Method: top-N heapsort  Memory: 36kB
              Buffers: shared hit=1387
              Worker 0:  Sort Method: top-N heapsort  Memory: 36kB
              ->  Parallel Seq Scan on orders  (cost=0.00..3114.71 rows=674 width=30) (actual time=0.020..4.656 rows=555 loops=2)
                    Filter: (((status)::text = 'cancelled'::text) AND (created_at >= (now() - '90 days'::interval)))
                    Rows Removed by Filter: 74445
                    Buffers: shared hit=1350
Planning:
  Buffers: shared hit=100
Planning Time: 0.482 ms
Execution Time: 8.771 ms
```

Before optimization PostgreSQL scanned the `orders` table and filtered cancelled rows afterwards.

## After

```text
Limit  (cost=0.29..284.78 rows=100 width=30) (actual time=0.045..0.137 rows=100 loops=1)
  Buffers: shared hit=100 read=2
  ->  Index Scan using idx_orders_cancelled_created_at on orders  (cost=0.29..3232.17 rows=1136 width=30) (actual time=0.045..0.132 rows=100 loops=1)
        Index Cond: (created_at >= (now() - '90 days'::interval))
        Buffers: shared hit=100 read=2
Planning:
  Buffers: shared hit=137
Planning Time: 0.557 ms
Execution Time: 0.160 ms
```

The partial index `idx_orders_cancelled_created_at` is used.

The sequential scan disappeared and PostgreSQL can read the recent cancelled rows directly from the index.

Execution time changed from approximately **8.771 ms** to **0.160 ms**.

---

# Q3 — Case-insensitive email lookup

The query searches for a user using `lower(email)`.

## Before

```text
Seq Scan on users  (cost=0.00..538.00 rows=100 width=55) (actual time=0.273..4.279 rows=1 loops=1)
  Filter: (lower((email)::text) = 'user1234@example.com'::text)
  Rows Removed by Filter: 19999
  Buffers: shared hit=238
Planning:
  Buffers: shared hit=83
Planning Time: 0.378 ms
Execution Time: 4.310 ms
```

Before optimization PostgreSQL scanned the full `users` table because the query applies `lower()` to the column.

## After

```text
Index Scan using idx_users_lower_email on users  (cost=0.29..8.30 rows=1 width=55) (actual time=0.024..0.025 rows=1 loops=1)
  Index Cond: (lower((email)::text) = 'user1234@example.com'::text)
  Buffers: shared hit=1 read=2
Planning:
  Buffers: shared hit=102 read=1
Planning Time: 0.593 ms
Execution Time: 0.061 ms
```

The expression index `idx_users_lower_email` matches the expression `lower(email)` used in the query.

The sequential scan disappeared.

Execution time changed from approximately **4.310 ms** to **0.061 ms**.

---

# Q4 — Full-text product search

The query searches the product catalogue for:

```text
шкіряні кросівки
```

The catalogue contains **120,000 products**.

The search matches **2,400 products**, which is approximately **2% of the catalogue**.

## Before

```text
Limit  (cost=6951.63..6951.68 rows=20 width=51) (actual time=18.073..18.077 rows=20 loops=1)
  Buffers: shared hit=5456
  ->  Sort  (cost=6951.63..6951.77 rows=56 width=51) (actual time=18.071..18.073 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=5456
        ->  Seq Scan on products  (cost=0.00..6950.14 rows=56 width=51) (actual time=0.038..17.664 rows=2400 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 117600
              Buffers: shared hit=5450
Planning:
  Buffers: shared hit=96
Planning Time: 0.671 ms
Execution Time: 18.142 ms
```

Before optimization PostgreSQL scanned all 120,000 products and filtered the matching rows.

## After

The query was executed multiple times after creation of the GIN index.
The last warm-cache execution is shown below.

```text
Limit  (cost=214.41..214.46 rows=20 width=51) (actual time=2.953..2.955 rows=20 loops=1)
  Buffers: shared hit=2415
  ->  Sort  (cost=214.41..214.53 rows=49 width=51) (actual time=2.952..2.953 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=2415
        ->  Bitmap Heap Scan on products  (cost=30.31..213.11 rows=49 width=51) (actual time=0.550..2.716 rows=2400 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=2400
              Buffers: shared hit=2409
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.30 rows=49 width=0) (actual time=0.356..0.356 rows=2400 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=9
Planning:
  Buffers: shared hit=121
Planning Time: 0.485 ms
Execution Time: 3.016 ms
```

PostgreSQL now uses the GIN index `idx_products_search_vector` through a `Bitmap Index Scan`.

The sequential scan disappeared.

The buffer usage dropped from approximately **5456 shared hits** to **2415 shared hits**.

Execution time changed from approximately **18.142 ms** to **3.016 ms**.

---

# Index usage

The optimization indexes are:

```text
idx_orders_user_created_at
idx_orders_cancelled_created_at
idx_users_lower_email
idx_products_search_vector
```

After executing all four optimized queries, this check:

```sql
SELECT indexrelname
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelid NOT IN (
      SELECT conindid
      FROM pg_constraint
      WHERE conindid <> 0
  );
```

returned no custom unused indexes.

The actual result was:

```text
(0 rows)
```

The database contains:

- one partial index: `idx_orders_cancelled_created_at`
- one expression index: `idx_users_lower_email`
- one GIN index over `tsvector`: `idx_products_search_vector`

---

## Морфологія

The PostgreSQL full-text search configuration used by the catalogue is:

```text
simple
```

Two different Ukrainian word forms were tested.

For:

```text
кросівки
```

the result was:

```text
2400
```

matches.

For:

```text
кросівок
```

the result was:

```text
1200
```

matches.

The numbers are different because the `simple` text-search configuration does not perform Ukrainian morphological analysis or stemming, so `кросівки` and `кросівок` are treated as different lexemes.
