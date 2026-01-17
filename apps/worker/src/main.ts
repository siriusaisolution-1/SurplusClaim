import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';
import { StructuredLoggerService } from './observability/structured-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  app.useLogger(app.get(StructuredLoggerService));
  await app.listen(process.env.PORT ?? 3002);
}

void bootstrap();
