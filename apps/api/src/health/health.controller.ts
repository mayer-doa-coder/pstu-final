import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const database = await this.checkDatabase();

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
