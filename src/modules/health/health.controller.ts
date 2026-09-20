import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import type { LivenessHealth, ReadinessHealth } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Process còn sống; dùng cho liveness probe. */
  @Get('live')
  getLiveness(): LivenessHealth {
    return this.healthService.getLiveness();
  }

  /** MongoDB và Redis sẵn sàng; dùng cho readiness probe. */
  @Get(['', 'ready'])
  getReadiness(): ReadinessHealth {
    return this.healthService.getReadiness();
  }
}
