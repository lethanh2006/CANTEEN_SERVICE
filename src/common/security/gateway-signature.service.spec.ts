import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { GatewaySignatureService } from './gateway-signature.service';

const SECRET = 'test-secret-with-enough-entropy';

function createService(
  overrides: Record<string, string> = {},
): GatewaySignatureService {
  const values: Record<string, string> = {
    CANTEEN_INTERNAL_SECRET: SECRET,
    CANTEEN_REQUIRE_SIGNATURE: 'true',
    CANTEEN_SIGNATURE_MAX_AGE_MS: '300000',
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new GatewaySignatureService(configService);
}

function sign(timestamp: string, requestId: string, payload: string): string {
  return createHmac('sha256', SECRET)
    .update(`${timestamp}.${requestId}.${payload}`)
    .digest('hex');
}

describe('GatewaySignatureService', () => {
  const payload = Buffer.from(
    JSON.stringify({ id: 'user-1', role: 'ADMIN' }),
  ).toString('base64');
  const requestId = 'request-1';

  it('accepts a valid signed user payload', () => {
    const timestamp = Date.now().toString();
    const service = createService();

    expect(() =>
      service.assertTrusted({
        payload,
        requestId,
        timestamp,
        signature: sign(timestamp, requestId, payload),
      }),
    ).not.toThrow();
  });

  it('rejects a payload with an invalid signature', () => {
    const service = createService();

    expect(() =>
      service.assertTrusted({
        payload,
        requestId,
        timestamp: Date.now().toString(),
        signature: '0'.repeat(64),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an expired payload', () => {
    const timestamp = (Date.now() - 600_000).toString();
    const service = createService();

    expect(() =>
      service.assertTrusted({
        payload,
        requestId,
        timestamp,
        signature: sign(timestamp, requestId, payload),
      }),
    ).toThrow(UnauthorizedException);
  });
});
