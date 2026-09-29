SELECT id, user_id, total_amount, created_at
FROM orders
WHERE status = 'cancelled'
  AND created_at >= now() - interval '90 days'
ORDER BY created_at DESC
LIMIT 100