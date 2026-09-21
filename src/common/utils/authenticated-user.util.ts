import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

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
