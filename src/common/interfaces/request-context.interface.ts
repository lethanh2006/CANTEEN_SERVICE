import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user.interface';

/** Request ID dùng để liên kết log trong suốt một HTTP request. */
export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
  user?: AuthenticatedUser;
}
