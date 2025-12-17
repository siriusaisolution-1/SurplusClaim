import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { StructuredLoggerService } from './observability/structured-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(StructuredLoggerService));
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
