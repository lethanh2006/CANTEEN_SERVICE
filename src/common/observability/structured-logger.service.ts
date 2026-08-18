import { Injectable, Logger } from '@nestjs/common';

export type LogDetails = Record<string, unknown>;

/**
 * Xuất log JSON ra stdout/stderr để Loki, ELK, Datadog hoặc collector đọc.
 * Telegram/Discord nên được cấu hình từ hệ thống monitoring, không gọi tại đây.
 */
@Injectable()
export class StructuredLoggerService {
  private readonly logger = new Logger('Canteen');

  info(event: string, details: LogDetails): void {
    this.logger.log(this.serialize(event, details));
  }

  warn(event: string, details: LogDetails): void {
    this.logger.warn(this.serialize(event, details));
  }

  error(event: string, details: LogDetails, stack?: string): void {
    this.logger.error(this.serialize(event, details), stack);
  }

  private serialize(event: string, details: LogDetails): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'canteen',
      event,
      ...details,
    });
  }
}
