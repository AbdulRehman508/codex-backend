import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

// JWT claims attached to the request by JwtAuthGuard.
export interface JwtUser {
  sub: string;
  email: string;
  role_id: number;
  iat?: number;
  exp?: number;
}

// Pull the authenticated user's JWT claims (or a single claim) off the request.
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const user = req.user;
    return data && user ? user[data] : user;
  },
);
