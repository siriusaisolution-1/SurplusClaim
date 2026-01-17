import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { Public } from './auth/auth.decorators';
import { prisma } from './prisma/prisma.client';

@Controller()
export class HealthController {
  @Get('health')
  @Public()
  getHealth() {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  @Public()
  async getReady() {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'api',
        message: 'Database unavailable'
      });
    }

    return { status: 'ok', service: 'api' };
  }
}
