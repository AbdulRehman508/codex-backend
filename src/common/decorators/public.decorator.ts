import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Mark a route/controller as public — skips the global JWT guard.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
