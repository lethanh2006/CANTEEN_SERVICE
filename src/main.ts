import '@nrapp/observability/register';
import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import {
  flushLoggerAndShutdownTelemetry,
  logAndRecordException,
} from '@nrapp/observability';
import { AppModule } from './app.module';
import { appLogger, nestLogger } from './common/observability/app-logger';
import { createValidationException } from './common/validation/validation-exception';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: nestLogger });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: createValidationException,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap().catch(async (error: unknown) => {
  logAndRecordException(
    appLogger,
    'process.bootstrap.failed',
    error,
    {},
    {
      message: 'Không thể khởi động dịch vụ căn tin',
      classification: {
        statusCode: 500,
        code: 'BOOTSTRAP_FAILED',
        expected: false,
        retryable: false,
        logLevel: 'fatal',
      },
    },
  );
  await flushLoggerAndShutdownTelemetry(appLogger, 3_000);
  process.exitCode = 1;
});
