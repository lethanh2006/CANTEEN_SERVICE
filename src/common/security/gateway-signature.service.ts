import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

interface SignedGatewayHeaders {
  payload: string;
  requestId?: string;
  signature?: string;
  timestamp?: string;
}

@Injectable()
export class GatewaySignatureService implements OnModuleInit {
  private readonly logger = new Logger(GatewaySignatureService.name);
  private readonly secret: string | undefined;
  private readonly signatureRequired: boolean;
  private readonly maxAgeMs: number;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('CANTEEN_INTERNAL_SECRET');
    this.signatureRequired =
      configService.get<string>('CANTEEN_REQUIRE_SIGNATURE')?.toLowerCase() ===
        'true' || configService.get<string>('NODE_ENV') === 'production';
    const configuredMaxAgeMs = Number(
      configService.get<string>('CANTEEN_SIGNATURE_MAX_AGE_MS') ?? 300_000,
    );
    this.maxAgeMs =
      Number.isFinite(configuredMaxAgeMs) && configuredMaxAgeMs > 0
        ? configuredMaxAgeMs
        : 300_000;
  }

  onModuleInit(): void {
    if (!this.secret && this.signatureRequired) {
      throw new Error(
        'Thiếu CANTEEN_INTERNAL_SECRET trong khi chữ ký Gateway là bắt buộc',
      );
    }

    if (this.secret && this.signatureRequired && this.secret.length < 32) {
      throw new Error('CANTEEN_INTERNAL_SECRET phải có ít nhất 32 ký tự');
    }

    if (!this.secret) {
      this.logger.warn(
        'Chưa cấu hình CANTEEN_INTERNAL_SECRET; chỉ nên dùng chế độ này khi phát triển local',
      );
    }
  }

  assertTrusted(headers: SignedGatewayHeaders): void {
    if (!this.secret && !this.signatureRequired) {
      return;
    }

    const { payload, requestId, signature, timestamp } = headers;
    if (!this.secret || !requestId || !signature || !timestamp) {
      throw new UnauthorizedException('Thông tin Gateway không hợp lệ');
    }

    const timestampNumber = Number(timestamp);
    if (
      !Number.isFinite(timestampNumber) ||
      Math.abs(Date.now() - timestampNumber) > this.maxAgeMs
    ) {
      throw new UnauthorizedException('Thông tin Gateway đã hết hạn');
    }

    const expected = createHmac('sha256', this.secret)
      .update(`${timestamp}.${requestId}.${payload}`)
      .digest('hex');
    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Chữ ký Gateway không hợp lệ');
    }
  }
}
