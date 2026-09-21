import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  classifyException,
  logAndRecordException,
  normalizeRouteTemplate,
} from '@nrapp/observability';
import type { Request, Response } from 'express';
import type { ValidationError } from 'class-validator';
import { appLogger } from './observability';
import type { RequestContext } from './request-context';

interface HttpRequestContext extends Request {
  requestContext?: RequestContext;
}

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequestContext>();
    const response = http.getResponse<Response>();
    const classification = classifyException(exception);

    let errorId: string | undefined;
    if (!classification.expected) {
      const result = logAndRecordException(
        appLogger,
        'http.request.failed',
        exception,
        {
          'http.request.method': request.method,
          'http.route': routeTemplate(request),
          'http.response.status_code': classification.statusCode,
          request_id: request.requestContext?.requestId,
        },
        { classification },
      );
      errorId = result.errorId;
    }

    const body = classification.expected
      ? expectedResponse(classification, request.requestContext?.requestId)
      : {
          statusCode: classification.statusCode,
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          requestId: request.requestContext?.requestId,
          errorId,
        };

    this.httpAdapterHost.httpAdapter.reply(
      response,
      body,
      classification.statusCode,
    );
  }
}

function routeTemplate(request: HttpRequestContext): string {
  const route = (request.route as { path?: unknown } | undefined)?.path;
  const base = request.baseUrl ?? '';
  return normalizeRouteTemplate(
    typeof route === 'string' ? `${base}${route}` : 'unknown',
  );
}

function expectedResponse(
  classification: ReturnType<typeof classifyException>,
  requestId: string | undefined,
): Record<string, unknown> {
  return {
    statusCode: classification.statusCode,
    code: classification.code,
    message: classification.safeMessage,
    ...(classification.validationFields.length
      ? { details: { fields: classification.validationFields } }
      : {}),
    requestId,
  };
}

function collectFieldPaths(errors: ValidationError[], prefix = ''): string[] {
  const fields: string[] = [];

  for (const error of errors) {
    const property = String(error.property ?? '').trim();
    if (!property || !/^[A-Za-z0-9_[\]-]{1,100}$/.test(property)) {
      continue;
    }

    const path = prefix ? `${prefix}.${property}` : property;
    if (error.constraints && Object.keys(error.constraints).length > 0) {
      fields.push(path);
    }
    if (error.children?.length) {
      fields.push(...collectFieldPaths(error.children, path));
    }
  }

  return fields;
}

export function createValidationException(
  errors: ValidationError[],
): UnprocessableEntityException {
  const fields = [...new Set(collectFieldPaths(errors))].slice(0, 50);

  return new UnprocessableEntityException({
    statusCode: 422,
    code: 'VALIDATION_ERROR',
    message: 'Dữ liệu không hợp lệ',
    details: { fields },
  });
}
