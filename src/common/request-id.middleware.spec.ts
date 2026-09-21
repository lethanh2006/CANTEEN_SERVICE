import { getLogContext } from '@nrapp/observability';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from './request-context';
import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
  SAFE_REQUEST_ID,
} from './request-id.middleware';

describe('Canteen request correlation contract', () => {
  const middleware = new RequestIdMiddleware();

  it('giữ canonical request ID hợp lệ từ Gateway mà không lưu startedAt', () => {
    const result = runMiddleware('gateway-request-123');

    expect(result.request.requestContext).toEqual({
      requestId: 'gateway-request-123',
    });
    expect(result.request.requestContext).not.toHaveProperty('startedAt');
    expect(result.context).toEqual({ request_id: 'gateway-request-123' });
  });

  it('thay request ID sai định dạng bằng ID an toàn', () => {
    const result = runMiddleware('../../unsafe request-id');
    const requestId = result.request.requestContext?.requestId;

    expect(requestId).toMatch(SAFE_REQUEST_ID);
    expect(requestId).not.toBe('../../unsafe request-id');
    expect(result.request.headers[REQUEST_ID_HEADER]).toBe(requestId);
    expect(result.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, requestId);
  });

  function runMiddleware(incomingRequestId?: string) {
    const request = {
      headers: incomingRequestId
        ? { [REQUEST_ID_HEADER]: incomingRequestId }
        : {},
    } as unknown as RequestWithContext;
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;
    let context: Record<string, unknown> = {};
    const next = jest.fn(() => {
      context = getLogContext();
    }) as NextFunction;

    middleware.use(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    return { context, request, setHeader };
  }
});
