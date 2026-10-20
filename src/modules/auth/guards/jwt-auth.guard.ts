import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { SESSION_COOKIE } from '../session-cookie';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // routes/controllers marked @Public() bypass auth
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException('Not signed in');
    }

    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        { secret: this.config.get<string>('jwt.secret') ?? 'dev-secret' },
      );
      (req as Request & { user?: unknown }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * The browser sends the session as an httpOnly cookie it cannot read. A
   * bearer header still works, for the Swagger UI, the end-to-end suite and
   * any non-browser client.
   */
  private extractToken(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const fromCookie = cookies?.[SESSION_COOKIE];
    if (fromCookie) return fromCookie;

    const header = req.headers.authorization;
    if (!header) return undefined;
    const [type, token] = header.split(' ');
    return type?.toLowerCase() === 'bearer' ? token : undefined;
  }
}
