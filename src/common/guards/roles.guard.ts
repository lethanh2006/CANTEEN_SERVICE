import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  AuthenticatedUser,
  parseAuthenticatedUser,
  RequestWithAuthenticatedUser,
} from '../interfaces/authenticated-user.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithAuthenticatedUser>();
    const base64Payload = request.headers['x-user-payload'];

    let user: AuthenticatedUser | null = null;
    if (typeof base64Payload === 'string') {
      try {
        const jsonString = Buffer.from(base64Payload, 'base64').toString(
          'utf8',
        );
        const parsed: unknown = JSON.parse(jsonString);
        user = parseAuthenticatedUser(parsed);
        if (!user) {
          throw new UnauthorizedException('Thông tin định danh không hợp lệ');
        }
        request.user = user;
      } catch {
        throw new UnauthorizedException('Thông tin định danh không hợp lệ');
      }
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    if (!user) {
      throw new UnauthorizedException('Yêu cầu thông tin định danh người dùng');
    }

    const hasRole = requiredRoles.some(
      (role) => user.role?.toLowerCase() === role.toLowerCase(),
    );
    if (!hasRole) {
      throw new ForbiddenException(
        'Bạn không có quyền truy cập vào tài nguyên này',
      );
    }

    return true;
  }
}
