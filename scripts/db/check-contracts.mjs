// Verifies that the migrated database matches the JSON contracts the frontend uses:
//   src/domain/access/access-catalog.json      → permissions, roles, role grants
//   src/domain/settings/setting-definitions.json → setting_definitions
// Usage: node scripts/db/check-contracts.mjs <psql connection args...>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const psqlArgs = process.argv.slice(2);
const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));

function query(sql) {
  const output = execFileSync(
    'psql',
    [...psqlArgs, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      encoding: 'utf8',
    },
  );
  return JSON.parse(output.trim() || 'null');
}

const catalog = readJson('src/domain/access/access-catalog.json');
const definitions = readJson('src/domain/settings/setting-definitions.json').definitions;
const allPermissionKeys = catalog.permissions.map((p) => p.key).sort();
let failures = 0;

function compare(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok - ${label}`);
  } else {
    failures += 1;
    console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

compare(
  'permissions match access-catalog.json',
  query(
    `select json_agg(json_build_object('key', key, 'module', module, 'sensitive', is_sensitive) order by key) from public.permissions`,
  ),
  catalog.permissions
    .map((p) => ({ key: p.key, module: p.module, sensitive: p.sensitive }))
    .sort((a, b) => a.key.localeCompare(b.key)),
);

compare(
  'system roles match access-catalog.json',
  query(
    `select json_agg(json_build_object('key', key, 'rank', rank, 'grantsAll', grants_all, 'name', name) order by key) from public.roles where is_system`,
  ),
  catalog.roles
    .map((r) => ({ key: r.key, rank: r.rank, grantsAll: r.grantsAll, name: r.name }))
    .sort((a, b) => a.key.localeCompare(b.key)),
);

const actualGrants = query(`
  select json_object_agg(key, perms) from (
    select r.key, coalesce(json_agg(rp.permission_key order by rp.permission_key) filter (where rp.permission_key is not null), '[]') as perms
    from public.roles r left join public.role_permissions rp on rp.role_id = r.id
    where r.is_system group by r.key
  ) s`);
for (const role of catalog.roles) {
  const expected = role.permissions === '*' ? allPermissionKeys : [...role.permissions].sort();
  compare(`role grants: ${role.key}`, actualGrants[role.key], expected);
}

compare(
  'setting definitions match setting-definitions.json',
  query(
    `select json_agg(json_build_object('key', key, 'scope', scope, 'isPublic', is_public, 'editPermission', edit_permission, 'publishPermission', publish_permission) order by key) from public.setting_definitions`,
  ),
  [...definitions].sort((a, b) => a.key.localeCompare(b.key)),
);

if (failures > 0) {
  console.error(`\n${failures} contract check(s) failed`);
  process.exit(1);
}
console.log('\nAll database contracts match the frontend catalogs.');
