import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedUser,
  RequestWithAuthenticatedUser,
} from '../interfaces/authenticated-user.interface';

export const User = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): unknown => {
    const request = ctx
      .switchToHttp()
      .getRequest<RequestWithAuthenticatedUser>();
    const user = request.user;

    return data === undefined ? user : user?.[data];
  },
);
