import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { toError } from './common/utils/error.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err: unknown) => {
  const error = toError(err);
  new Logger('Bootstrap').error(
    `Không thể khởi động dịch vụ căn tin: ${error.message}`,
    error.stack,
  );
  process.exitCode = 1;
});
