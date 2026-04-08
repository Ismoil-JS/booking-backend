import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestUser } from '../strategies/jwt.strategy';
import { UserService } from '../../user/user.service';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private userService: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');
    let userRole = String(user.userType ?? '').toUpperCase();
    if (!userRole && user.userId) {
      const dbUser = await this.userService.findById(Number(user.userId));
      userRole = String(dbUser?.userType ?? '').toUpperCase();
    }
    const allowed = requiredRoles.some((r) => String(r).toUpperCase() === userRole);
    if (!allowed) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
