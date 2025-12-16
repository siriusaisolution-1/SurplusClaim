import { Module } from '@nestjs/common';

import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';

@Module({
  providers: [ConnectorsService],
  controllers: [ConnectorsController]
})
export class ConnectorsModule {}
