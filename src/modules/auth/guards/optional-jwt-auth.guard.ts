import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Like JwtAuthGuard but does not throw when token is missing or invalid; request.user is set to null. */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = await super.canActivate(context);
      return !!result;
    } catch {
      const request = context.switchToHttp().getRequest<{ user?: unknown }>();
      request.user = null;
      return true;
    }
  }

  handleRequest<TUser>(err: unknown, user: TUser): TUser | null {
    if (err || !user) return null;
    return user;
  }
}
