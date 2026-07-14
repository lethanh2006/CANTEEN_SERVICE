import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const base64Payload = request.headers['x-user-payload'];

    // Decodes the user payload from API Gateway if present
    let user: any = null;
    if (base64Payload) {
      try {
        const jsonString = Buffer.from(base64Payload as string, 'base64').toString('utf8');
        user = JSON.parse(jsonString);
        request.user = user;
      } catch (error) {
        throw new UnauthorizedException('Thông tin định danh không hợp lệ');
      }
    }

    // Get roles metadata from route handler or class
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, the route is public (or doesn't require role validation, just parses user)
    if (!requiredRoles) {
      return true;
    }

    // If roles are required, but there was no identity payload, block access
    if (!user) {
      throw new UnauthorizedException('Yêu cầu thông tin định danh người dùng');
    }

    // Check if the user's role matches any of the required roles
    const hasRole = requiredRoles.some((role) => user.role?.toLowerCase() === role.toLowerCase());
    if (!hasRole) {
      throw new ForbiddenException('Bạn không có quyền truy cập vào tài nguyên này');
    }

    return true;
  }
}
