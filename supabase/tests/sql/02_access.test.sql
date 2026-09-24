-- RBAC, anti-escalation rules, first-owner bootstrap and audit log.
begin;

create temporary table ids on commit drop as
select
  tests.create_user('owner@test.local') as owner_id,
  tests.create_user('super@test.local', 'super_admin') as super_id,
  tests.create_user('manager@test.local', 'store_manager') as manager_id,
  tests.create_user('sales@test.local', 'sales') as sales_id,
  tests.create_user('customer@test.local') as customer_id,
  tests.create_user('target@test.local') as target_id;
grant select on ids to authenticated, anon;

-- ── Bootstrap ──────────────────────────────────────────────────────────────
select tests.assert(app_private.bootstrap_first_owner('OWNER@test.local') = (select owner_id from ids), 'bootstrap assigns the first owner (case-insensitive email)');
select tests.assert_raises($$select app_private.bootstrap_first_owner('customer@test.local')$$, '42501', 'bootstrap refuses once an owner exists');
select tests.assert_raises($$select app_private.bootstrap_first_owner('nobody@test.local')$$, '42501', 'bootstrap refuses even for unknown emails once an owner exists');

select tests.act_as((select customer_id from ids));
select tests.assert_raises($$select app_private.bootstrap_first_owner('customer@test.local')$$, '42501', 'API roles cannot reach app_private');
reset role;

-- ── get_my_access ──────────────────────────────────────────────────────────
select tests.act_as((select owner_id from ids));
select tests.assert((public.get_my_access() ->> 'grantsAll')::boolean, 'owner grantsAll');
select tests.assert_equal(jsonb_array_length(public.get_my_access() -> 'permissions'), 43, 'owner effective permissions = all');
reset role;

select tests.act_as((select sales_id from ids));
select tests.assert_equal(public.get_my_access() -> 'roles' -> 0 ->> 'key', 'sales', 'sales role reported');
select tests.assert_equal(jsonb_array_length(public.get_my_access() -> 'permissions'), 11, 'sales has 11 permissions');
select tests.assert(app.has_permission('orders.manage'), 'sales can manage orders');
select tests.assert(not app.has_permission('pricing.manage'), 'sales cannot change prices');
reset role;

select tests.act_as((select customer_id from ids));
select tests.assert_equal(jsonb_array_length(public.get_my_access() -> 'roles'), 0, 'customer has no roles');
select tests.assert(not app.is_staff(), 'customer is not staff');
select tests.assert_equal((select count(*)::int from public.roles), 0, 'customer cannot read the role catalog');
select tests.assert_equal((select count(*)::int from public.profiles), 1, 'customer sees only their own profile');
select tests.assert_raises(
  format($$insert into public.user_roles (user_id, role_id) select %L, id from public.roles where key = 'owner'$$, (select customer_id from ids)),
  '42501', 'customer cannot write user_roles directly');
select tests.assert_raises(format($$select public.assign_role(%L, 'sales')$$, (select customer_id from ids)), '42501', 'customer cannot call assign_role');

-- Profile: own row only, only whitelisted columns.
update public.profiles set full_name = 'Customer Name' where id = (select customer_id from ids);
update public.profiles set full_name = 'Hacked' where id = (select target_id from ids);
select tests.assert_raises(format($$update public.profiles set email = 'x@y.z' where id = %L$$, (select customer_id from ids)), '42501', 'customer cannot change profile email column');
reset role;
select tests.assert_equal((select full_name from public.profiles where id = (select customer_id from ids)), 'Customer Name', 'customer updated own profile');
select tests.assert((select full_name from public.profiles where id = (select target_id from ids)) is null, 'customer cannot update another profile');

select tests.act_as_anon();
select tests.assert_raises($$select public.get_my_access()$$, '42501', 'anon cannot call get_my_access');
select tests.assert_raises($$select count(*) from public.profiles$$, '42501', 'anon cannot read profiles');
reset role;

-- ── Anti-escalation ───────────────────────────────────────────────────────
select tests.act_as((select super_id from ids));
select public.assign_role((select target_id from ids), 'store_manager');
select tests.assert(exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.user_id = (select target_id from ids) and r.key = 'store_manager'), 'super admin assigned store_manager');
select tests.assert_raises(format($$select public.assign_role(%L, 'super_admin')$$, (select target_id from ids)), '42501', 'super admin cannot grant a role at their own rank');
select tests.assert_raises(format($$select public.assign_role(%L, 'owner')$$, (select target_id from ids)), '42501', 'super admin cannot grant owner');
select tests.assert_raises(format($$select public.revoke_role(%L, 'owner')$$, (select owner_id from ids)), '42501', 'super admin cannot revoke owner');
select tests.assert_raises(format($$select public.assign_role(%L, 'no_such_role')$$, (select target_id from ids)), 'P0002', 'unknown role rejected');
select public.set_role_permissions('sales', array['dashboard.view', 'orders.view', 'catalog.manage']);
select tests.assert_equal((select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.key = 'sales'), 3, 'super admin replaced sales permissions');
select tests.assert_raises($$select public.set_role_permissions('sales', array['nope.nope'])$$, '22023', 'unknown permission rejected');
select tests.assert_raises($$select public.set_role_permissions('owner', array['dashboard.view'])$$, '42501', 'owner role permissions are implicit');
select tests.assert_raises($$select public.set_role_permissions('super_admin', array['dashboard.view'])$$, '42501', 'cannot edit a role at own rank');
reset role;

select tests.act_as((select manager_id from ids));
select tests.assert_raises(format($$select public.assign_role(%L, 'sales')$$, (select target_id from ids)), '42501', 'store manager lacks roles.manage');
reset role;

-- A non-owner with roles.manage can only grant permissions they hold themselves.
insert into public.role_permissions (role_id, permission_key)
select id, 'roles.manage' from public.roles where key = 'store_manager';
select tests.act_as((select manager_id from ids));
select tests.assert_raises($$select public.set_role_permissions('sales', array['dashboard.view', 'integrations.manage'])$$, '42501', 'cannot grant a permission you do not hold');
select public.set_role_permissions('sales', array['dashboard.view', 'orders.view']);
reset role;

-- Owner rules.
select tests.act_as((select owner_id from ids));
select tests.assert_raises(format($$select public.revoke_role(%L, 'owner')$$, (select owner_id from ids)), '42501', 'last owner cannot be removed');
select public.assign_role((select target_id from ids), 'owner');
select public.revoke_role((select target_id from ids), 'owner');
select tests.assert(not app.is_owner((select target_id from ids)), 'owner can grant and revoke another owner');
reset role;

-- MFA gate for sensitive actions when enabled.
update public.site_settings set value = '{"adminMfaRequired": true}' where key = 'security';
select tests.act_as((select owner_id from ids), 'aal1');
select tests.assert_raises(format($$select public.assign_role(%L, 'sales')$$, (select target_id from ids)), '42501', 'sensitive RPC requires aal2 when MFA is enforced');
reset role;
select tests.act_as((select owner_id from ids), 'aal2');
select public.assign_role((select target_id from ids), 'sales');
reset role;
update public.site_settings set value = '{"adminMfaRequired": false}' where key = 'security';

-- ── Audit log ─────────────────────────────────────────────────────────────
select tests.assert(exists (
  select 1 from public.audit_logs
  where entity_type = 'public.user_roles' and action = 'insert' and actor_id = (select super_id from ids)
), 'role assignment audited with the acting user');
select tests.assert(exists (select 1 from public.audit_logs where action = 'access.bootstrap_owner'), 'bootstrap audited');
select tests.assert_raises($$update public.audit_logs set action = 'tampered'$$, '42501', 'audit log rows cannot be updated (even by the owner role)');
select tests.assert_raises($$delete from public.audit_logs$$, '42501', 'audit log rows cannot be deleted');

select tests.act_as((select customer_id from ids));
select tests.assert_equal((select count(*)::int from public.audit_logs), 0, 'customers cannot read the audit log');
reset role;
select tests.act_as((select manager_id from ids));
select tests.assert((select count(*) from public.audit_logs) > 0, 'store manager (audit.view) can read the audit log');
select tests.assert_raises($$insert into public.audit_logs (action, entity_type) values ('fake.event', 'x')$$, '42501', 'staff cannot forge audit entries');
reset role;

rollback;
