import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { toError } from '../../common/error.util';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';
    this.client = createClient({
      url: redisUrl,
      RESP: 2,
      socket: {
        reconnectStrategy: (retries) => {
          this.logger.warn(`Redis đang thử kết nối lại lần ${retries}`);
          return Math.min(retries * 100, 3000);
        },
      },
    }) as unknown as RedisClientType;

    this.client.on('connect', () => this.logger.log('Redis đang kết nối'));
    this.client.on('ready', () =>
      this.logger.log('Redis đã kết nối thành công'),
    );
    this.client.on('reconnecting', () =>
      this.logger.log('Redis đang kết nối lại'),
    );
    this.client.on('end', () => this.logger.warn('Kết nối Redis đã đóng'));
    this.client.on('error', (err: unknown) => {
      const error = toError(err);
      this.logger.error(`Lỗi Redis: ${error.message}`, error.stack);
    });

    try {
      await this.client.connect();
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.error(
        `Không thể kết nối Redis khi khởi động: ${error.message}`,
        error.stack,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err: unknown) {
        const error = toError(err);
        this.logger.error(
          `Không thể ngắt kết nối Redis: ${error.message}`,
          error.stack,
        );
      }
    }
  }

  isReady(): boolean {
    return this.client?.isReady === true;
  }

  // Các thao tác Redis List phục vụ ngăn xếp hoàn tác và làm lại.
  async rPush(key: string, value: string): Promise<number> {
    return this.client.rPush(key, value);
  }

  async rPop(key: string): Promise<string | null> {
    return this.client.rPop(key);
  }

  async lTrim(key: string, start: number, end: number): Promise<string> {
    return this.client.lTrim(key, start, end);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(key, seconds);
    return !!result;
  }
}
