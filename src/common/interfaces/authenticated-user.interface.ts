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
