import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user.interface';

/** Dữ liệu theo suốt một HTTP request để tracing và logging. */
export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
  user?: AuthenticatedUser;
}
