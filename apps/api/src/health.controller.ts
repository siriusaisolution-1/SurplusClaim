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

    await this.ensureMigrationsApplied();

    return { status: 'ok', service: 'api' };
  }

  private async ensureMigrationsApplied() {
    try {
      const result = await prisma.$queryRawUnsafe<{ count: number }[]>(
        'SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL'
      );
      if ((result?.[0]?.count ?? 0) > 0) {
        throw new ServiceUnavailableException({
          status: 'error',
          service: 'api',
          message: 'Pending migrations detected'
        });
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
    }
  }
}
