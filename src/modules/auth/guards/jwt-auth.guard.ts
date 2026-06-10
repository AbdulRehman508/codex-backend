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
      throw new UnauthorizedException('Authorization bearer token missing');
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

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (!header) return undefined;
    const [type, token] = header.split(' ');
    return type?.toLowerCase() === 'bearer' ? token : undefined;
  }
}
