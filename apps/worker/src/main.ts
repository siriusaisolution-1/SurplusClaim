import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  await app.listen(process.env.PORT ?? 3002);
}

void bootstrap();
