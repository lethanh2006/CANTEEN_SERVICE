import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { toError } from '../utils/error.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import type { RequestContext } from '../interfaces/request-context.interface';
import { StructuredLoggerService } from '../observability/structured-logger.service';

interface HttpRequestContext {
  method?: string;
  originalUrl?: string;
  url?: string;
  user?: AuthenticatedUser;
  requestContext?: RequestContext;
}

/**
 * Ghi log lỗi tập trung và trả response HTTP theo chuẩn của NestJS.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: StructuredLoggerService,
  ) {}

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
    const requestContext = request.requestContext;
    const logDetails = {
      requestId: requestContext?.requestId,
      statusCode,
      method: request.method,
      path: request.originalUrl ?? request.url,
      ...(userId ? { userId } : {}),
      errorName: error.name,
      message: error.message,
      durationMs: requestContext
        ? Number(process.hrtime.bigint() - requestContext.startedAt) / 1e6
        : undefined,
    };

    if (statusCode >= 500) {
      this.logger.error('http_request_failed', logDetails, error.stack);
    } else {
      this.logger.warn('http_request_rejected', logDetails);
    }

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const responseBody =
      exceptionResponse !== null &&
      typeof exceptionResponse === 'object' &&
      !Array.isArray(exceptionResponse)
        ? {
            ...(exceptionResponse as Record<string, unknown>),
            requestId: requestContext?.requestId,
          }
        : {
            statusCode,
            message: exceptionResponse ?? 'Internal server error',
            requestId: requestContext?.requestId,
          };

    httpAdapter.reply(httpContext.getResponse(), responseBody, statusCode);
  }
}
