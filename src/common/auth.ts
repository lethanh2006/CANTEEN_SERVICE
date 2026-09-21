import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

export enum Role {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

/** Thông tin người dùng được Gateway chuyển tiếp tới dịch vụ căn tin. */
export interface AuthenticatedUser {
  _id?: string;
  id?: string;
  role?: string;
}

export interface RequestWithAuthenticatedUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

/** Chuyển dữ liệu không xác định thành thông tin người dùng an toàn về kiểu. */
export function parseAuthenticatedUser(
  value: unknown,
): AuthenticatedUser | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const user: AuthenticatedUser = {
    ...(typeof record._id === 'string' ? { _id: record._id } : {}),
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.role === 'string' ? { role: record.role } : {}),
  };

  return user._id || user.id ? user : null;
}

export const AUTHENTICATED_KEY = 'authenticated';
export const ROLES_KEY = 'roles';

/** Endpoint cần đăng nhập nhưng không giới hạn vào một role cụ thể. */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const User = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    context: ExecutionContext,
  ): unknown => {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithAuthenticatedUser>();
    const user = request.user;

    return data === undefined ? user : user?.[data];
  },
);
