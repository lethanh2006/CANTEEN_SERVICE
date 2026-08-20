import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { of } from 'rxjs';
import type { RequestWithContext } from '../interfaces/request-context.interface';
import {
  type LogDetails,
  StructuredLoggerService,
} from '../observability/structured-logger.service';
import { HttpLoggingInterceptor } from './http-logging.interceptor';

describe('HttpLoggingInterceptor', () => {
  it('ghi log completed với các field HTTP bắt buộc', (done) => {
    const info = jest.fn<void, [string, LogDetails]>();
    const logger = {
      info,
    } as unknown as StructuredLoggerService;
    const request = {
      method: 'GET',
      originalUrl: '/api/canteen/menu',
      requestContext: {
        requestId: 'request-123',
        startedAt: process.hrtime.bigint(),
      },
      user: { _id: 'user-123' },
    } as unknown as RequestWithContext;
    const response = { statusCode: 200 } as Response;
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ ok: true }) } as CallHandler;
    const interceptor = new HttpLoggingInterceptor(logger);

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        const completedCall = info.mock.calls.find(
          ([event]) => event === 'http_request_completed',
        );
        expect(completedCall).toBeDefined();
        const [event, details] = completedCall!;
        expect(event).toBe('http_request_completed');
        expect(details).toMatchObject({
          requestId: 'request-123',
          userId: 'user-123',
          method: 'GET',
          path: '/api/canteen/menu',
          statusCode: 200,
        });
        expect(typeof details.durationMs).toBe('number');
        done();
      },
    });
  });
});
