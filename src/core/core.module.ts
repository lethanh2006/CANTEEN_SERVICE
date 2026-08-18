import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { HttpLoggingInterceptor } from '../common/interceptors/http-logging.interceptor';
import { RequestIdMiddleware } from '../common/middleware/request-id.middleware';
import { StructuredLoggerService } from '../common/observability/structured-logger.service';
import { GatewaySignatureService } from '../common/security/gateway-signature.service';

/** Đăng ký các concern áp dụng xuyên suốt toàn bộ HTTP application. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    StructuredLoggerService,
    GatewaySignatureService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [StructuredLoggerService, GatewaySignatureService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
