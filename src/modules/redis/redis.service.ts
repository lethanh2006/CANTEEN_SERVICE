import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';
    this.client = createClient({
      url: redisUrl,
      RESP: 2,
      socket: {
        reconnectStrategy: (retries) => {
          this.logger.warn(`Redis reconnect attempt: ${retries}`);
          return Math.min(retries * 100, 3000);
        },
      },
    }) as unknown as RedisClientType;

    this.client.on('connect', () => this.logger.log('Redis connecting...'));
    this.client.on('ready', () => this.logger.log('Connected to Redis successfully'));
    this.client.on('reconnecting', () => this.logger.log('Redis reconnecting...'));
    this.client.on('end', () => this.logger.warn('Redis connection closed'));
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));

    try {
      await this.client.connect();
    } catch (err) {
      this.logger.error(`Failed to connect to Redis initially: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        this.logger.error(`Failed to disconnect from Redis: ${err.message}`);
      }
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }

  // Redis LIST operations for Stack behavior
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
