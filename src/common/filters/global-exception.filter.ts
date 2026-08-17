import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { toError } from '../utils/error.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

interface HttpRequestContext {
  method?: string;
  originalUrl?: string;
  url?: string;
  user?: AuthenticatedUser;
}

/**
 * Ghi log lỗi tập trung và trả response HTTP theo chuẩn của NestJS.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<HttpRequestContext>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = toError(exception);
    const userId = request.user?._id ?? request.user?.id;
    const logDetails = JSON.stringify({
      statusCode,
      method: request.method,
      path: request.originalUrl ?? request.url,
      ...(userId ? { userId } : {}),
      errorName: error.name,
      message: error.message,
    });

    if (statusCode >= 500) {
      this.logger.error(logDetails, error.stack);
    } else {
      this.logger.warn(logDetails);
    }

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const responseBody =
      exceptionResponse !== null && typeof exceptionResponse === 'object'
        ? exceptionResponse
        : {
            statusCode,
            message: exceptionResponse ?? 'Internal server error',
          };

    httpAdapter.reply(httpContext.getResponse(), responseBody, statusCode);
  }
}
