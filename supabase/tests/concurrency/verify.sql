-- LOCAL TESTING ONLY. Assertions after the parallel sessions finished.
select tests.assert_equal((select count(*)::int from public.stock_reservations r
                           join public.product_variants v on v.id = r.variant_id
                           where v.sku = 'RN15P-256GB-PURPLE' and r.status = 'active'), 1,
  'concurrency: exactly one reservation for the last unit');
select tests.assert_equal((select count(*)::int from public.orders o join auth.users u on u.id = o.customer_id
                           where u.email in ('a@race.local', 'b@race.local')), 1,
  'concurrency: exactly one of two racing customers got an order');
select tests.assert_equal((select count(*)::int from public.orders o join auth.users u on u.id = o.customer_id
                           where u.email = 'c@race.local'), 1,
  'concurrency: a double-submitted checkout (same key, two sessions) creates one order');
