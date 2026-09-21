import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { flushLogger, logException } from '@nrapp/observability';
import { AppModule } from './app.module';
import { createValidationException } from './common/filters/global-exception.filter';
import { appLogger, nestLogger } from './common/logging/logger';

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
  logException(
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
  await flushLogger(appLogger);
  process.exitCode = 1;
});
