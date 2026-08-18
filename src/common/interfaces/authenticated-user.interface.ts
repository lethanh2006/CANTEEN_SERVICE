/**
 * Thông tin người dùng được Gateway chuyển tiếp tới dịch vụ căn tin.
 */
export interface AuthenticatedUser {
  _id?: string;
  id?: string;
  role?: string;
}

export interface RequestWithAuthenticatedUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

/**
 * Chuyển dữ liệu không xác định thành thông tin người dùng an toàn về kiểu.
 */
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
