import { SetMetadata } from '@nestjs/common';

export type PermAction = 'view' | 'create' | 'edit' | 'delete';

export const PERMISSION_KEY = 'required_permission';
export const ADMIN_ONLY_KEY = 'admin_only';

export interface RequiredPermission {
  /** access-catalog module key, e.g. 'sales' */
  module: string;
  action: PermAction;
}

/**
 * Gate a route on the caller's role matrix, e.g.
 * `@RequirePermission('sales', 'create')`. Admins always pass.
 * Routes with no decorator stay open to any authenticated user.
 */
export const RequirePermission = (module: string, action: PermAction) =>
  SetMetadata<string, RequiredPermission>(PERMISSION_KEY, { module, action });

/** Only the Admin role may call this route, whatever the matrix says. */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
