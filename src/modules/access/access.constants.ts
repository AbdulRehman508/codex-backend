/**
 * Canonical catalog of app modules whose access is controlled per role.
 * Stored permissions reference a module by its stable `key`; `label` is
 * display-only and `group` clusters child modules under a section header
 * (e.g. Customer/Office/Staff under "User Management"). Renaming a label or
 * group never orphans saved permissions. Add new modules here — existing
 * roles simply default them to no access.
 *
 * Keep same-group entries contiguous: the matrix renders sections in order.
 */
export interface AccessModule {
  key: string;
  label: string;
  group?: string;
}

export const ACCESS_MODULES: ReadonlyArray<AccessModule> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'sales', label: 'Sales' },
  { key: 'stock', label: 'Stock' },
  { key: 'products', label: 'Products' },
  { key: 'reports', label: 'Reports' },

  // User Management children
  { key: 'customer', label: 'Customer', group: 'User Management' },
  { key: 'office', label: 'Office', group: 'User Management' },
  { key: 'staff', label: 'Staff', group: 'User Management' },

  // Settings children
  { key: 'access_control', label: 'Access Control', group: 'Settings' },
  { key: 'role', label: 'Role', group: 'Settings' },
];
