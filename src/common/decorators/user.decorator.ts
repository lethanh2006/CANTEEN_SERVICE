import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedUser,
  RequestWithAuthenticatedUser,
} from '../interfaces/authenticated-user.interface';

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
