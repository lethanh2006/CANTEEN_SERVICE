import { ConflictException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { appLogger } from '../observability/app-logger';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter canteen observability', () => {
  const reply = jest.fn(
    (response: unknown, body: unknown, statusCode: number) => {
      void response;
      void body;
      void statusCode;
    },
  );
  const filter = new GlobalExceptionFilter({
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost);

  afterEach(() => {
    jest.restoreAllMocks();
    reply.mockReset();
  });

  it('không ghi lại expected 4xx đã do Gateway sở hữu', () => {
    const errorSpy = jest.spyOn(appLogger, 'error').mockImplementation();
    const host = httpHost('req-409');

    filter.catch(new ConflictException('Trạng thái không hợp lệ'), host);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        statusCode: 409,
        code: 'CONFLICT',
        requestId: 'req-409',
      }),
      409,
    );
  });

  it('ghi đúng một origin error và không lộ chi tiết 5xx', () => {
    const errorSpy = jest.spyOn(appLogger, 'error').mockImplementation();
    const host = httpHost('req-500');

    filter.catch(
      Object.assign(new Error('mongodb internal address'), {
        code: 'ECONNREFUSED',
      }),
      host,
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const response = reply.mock.calls[0][1] as Record<string, unknown>;
    expect(response).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: 'req-500',
    });
    expect(response.errorId).toEqual(expect.any(String));
    expect(JSON.stringify(response)).not.toContain('mongodb');
    expect(JSON.stringify(response)).not.toContain('ECONNREFUSED');
  });
});

function httpHost(requestId: string): ArgumentsHost {
  const response = {};
  const request = {
    method: 'POST',
    baseUrl: '/api/canteen',
    route: { path: '/orders' },
    requestContext: { requestId },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}
