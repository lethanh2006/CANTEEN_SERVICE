import { createAppLogger, PinoNestLogger } from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'canteen',
});

export const nestLogger = new PinoNestLogger(appLogger, 'Canteen');
