import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

// BigInt 全局 JSON 序列化（雪花/自增大整数统一转字符串，避免精度丢失）
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`研选营销智能推送系统后端已启动：http://localhost:${port}/api（DRY_RUN=${process.env.DRY_RUN ?? 'true'}）`);
}
bootstrap();
