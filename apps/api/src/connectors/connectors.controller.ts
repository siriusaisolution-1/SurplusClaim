import { Controller, Get } from '@nestjs/common';

import { ConnectorsService } from './connectors.service';

@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get('status')
  getStatus() {
    return { connectors: this.connectors.getStatus() };
  }
}
