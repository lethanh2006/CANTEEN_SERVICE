import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_KEY = 'authenticated';

/** Endpoint cần đăng nhập nhưng không giới hạn vào một role cụ thể. */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
