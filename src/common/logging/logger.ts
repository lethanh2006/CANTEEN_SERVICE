import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  createAppLogger,
  flushLogger,
  PinoNestLogger,
} from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'canteen',
});

export const nestLogger = new PinoNestLogger(appLogger, 'Canteen');

@Injectable()
export class LoggerLifecycleService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await flushLogger(appLogger);
  }
}
