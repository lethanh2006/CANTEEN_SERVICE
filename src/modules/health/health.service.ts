import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConnectionStates } from 'mongoose';
import type { Connection } from 'mongoose';
import { RedisService } from '../redis/redis.service';

export interface DependencyHealth {
  mongodb: 'up' | 'down';
  redis: 'up' | 'down';
}

export interface LivenessHealth {
  status: 'ok';
  service: 'canteen';
  timestamp: string;
}

export interface ReadinessHealth {
  status: 'ok' | 'error';
  service: 'canteen';
  dependencies: DependencyHealth;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly redisService: RedisService,
  ) {}

  getLiveness(): LivenessHealth {
    return {
      status: 'ok',
      service: 'canteen',
      timestamp: new Date().toISOString(),
    };
  }

  getReadiness(): ReadinessHealth {
    const dependencies: DependencyHealth = {
      mongodb:
        this.mongoConnection.readyState === ConnectionStates.connected
          ? 'up'
          : 'down',
      redis: this.redisService.isReady() ? 'up' : 'down',
    };
    const isReady = Object.values(dependencies).every(
      (status) => status === 'up',
    );
    const response: ReadinessHealth = {
      status: isReady ? 'ok' : 'error',
      service: 'canteen',
      dependencies,
      timestamp: new Date().toISOString(),
    };

    if (!isReady) {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
