-- LOCAL TESTING ONLY. Committed setup for the multi-session race tests (throwaway database).
update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';
update public.site_settings set value = jsonb_build_object(
    'preset', 'custom',
    'highValue', jsonb_build_object('enabled', false, 'threshold', 100000),
    'multipleExpensive', jsonb_build_object('enabled', false, 'unitPrice', 20000, 'minUnits', 2),
    'newCustomer', jsonb_build_object('enabled', false, 'minTotal', 30000),
    'splitPayment', jsonb_build_object('enabled', false),
    'unfinishedOrders', jsonb_build_object('enabled', false, 'maxCount', 2, 'windowDays', 7),
    'velocity', jsonb_build_object('enabled', false, 'maxOrders', 3, 'windowHours', 1))
  where key = 'order_review';
update public.product_variants set stock_quantity = 1 where sku = 'RN15P-256GB-PURPLE';
select tests.create_user('a@race.local');
select tests.create_user('b@race.local');
select tests.create_user('c@race.local');
select tests.create_user('w@race.local');
