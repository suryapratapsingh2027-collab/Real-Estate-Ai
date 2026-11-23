import type { RoleName } from './enums';

export const PERMISSIONS = [
  'dashboard:read',
  'property:read',
  'property:write',
  'broker:read',
  'broker:write',
  'customer:read',
  'customer:write',
  'lead:read',
  'lead:read_all',
  'lead:write',
  'lead:assign',
  'conversation:read',
  'conversation:reply',
  'call:read',
  'call:create',
  'followup:read',
  'followup:write',
  'analytics:read',
  'settings:business',
  'settings:ai',
  'settings:integrations',
  'user:manage',
  'audit:read',
  'notification:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ADMIN_PERMS: Permission[] = PERMISSIONS.filter(
  (p) => !['settings:integrations', 'user:manage', 'audit:read', 'settings:ai'].includes(p),
);

const BROKER_PERMS: Permission[] = [
  'dashboard:read',
  'property:read',
  'customer:read',
  'lead:read',
  'lead:write',
  'conversation:read',
  'conversation:reply',
  'call:read',
  'followup:read',
  'followup:write',
  'notification:read',
];

/**
 * Default role → permission matrix. Seeded into the Role/Permission tables;
 * the API reads permissions from the DB so they can be changed without a deploy.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  ADMIN: ADMIN_PERMS,
  BROKER: BROKER_PERMS,
};
