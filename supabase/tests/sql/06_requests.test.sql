-- "Notify me when available" and Coming Soon waitlist intake.
begin;
update public.site_settings set value = value || '{"showDemoCatalog": true}' where key = 'features';

select tests.act_as_anon();
select tests.assert_equal(public.request_stock_alert('iphone-18-pro', 'IP18P-1TB-ORANGE', 'Mona', '0121 200 4229') ->> 'status', 'created', 'anonymous stock alert accepted');
select tests.assert_equal(public.request_stock_alert('iphone-18-pro', 'IP18P-1TB-ORANGE', 'Mona', '+201212004229') ->> 'status', 'duplicate', 'duplicate request detected across phone formats');
select tests.assert_equal(public.request_stock_alert('iphone-18-pro', null, 'Mona', '01212004229', 'mona@example.com') ->> 'status', 'created', 'product-level alert');
select tests.assert_raises($$select public.request_stock_alert('iphone-18-pro', null, 'M', '01212004229')$$, '22023', 'name validated');
select tests.assert_raises($$select public.request_stock_alert('iphone-18-pro', null, 'Mona', '12345')$$, '22023', 'phone validated');
select tests.assert_raises($$select public.request_stock_alert('iphone-18-pro', null, 'Mona', '01212004229', 'not-an-email')$$, '22023', 'email validated');
select tests.assert_raises($$select public.request_stock_alert('no-such-product', null, 'Mona', '01212004229')$$, 'P0002', 'unknown product rejected');
select tests.assert_raises($$select public.request_stock_alert('iphone-18-pro', 'OTHER-SKU', 'Mona', '01212004229')$$, 'P0002', 'variant must belong to the product');
select tests.assert_equal(public.join_waitlist('iphone-duo', 'Karim', '01012345678', null, '256GB', 'Black') ->> 'status', 'created', 'waitlist joined');
select tests.assert_equal(public.join_waitlist('iphone-duo', 'Karim', '01012345678') ->> 'status', 'duplicate', 'waitlist de-duplicated');
select tests.assert_raises($$select count(*) from public.stock_notifications$$, '42501', 'anon cannot read requests');
select tests.assert_raises($$select count(*) from public.waitlist_entries$$, '42501', 'anon cannot read waitlist');
reset role;

select tests.assert_equal((select phone from public.stock_notifications limit 1), '+201212004229', 'phone stored in E.164');

select tests.act_as(tests.create_user('shopper6@test.local'));
select tests.assert_equal((select count(*)::int from public.stock_notifications), 0, 'customers cannot read other people''s requests');
reset role;
select tests.act_as(tests.create_user('sales6@test.local', 'sales'));
select tests.assert_equal((select count(*)::int from public.stock_notifications), 2, 'staff with waitlists.manage can follow up');
select tests.assert_equal((select desired_storage from public.waitlist_entries limit 1), '256GB', 'waitlist preferences stored');
reset role;

rollback;
