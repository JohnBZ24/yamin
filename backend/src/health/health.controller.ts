import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthService } from './health.service';

@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiExcludeEndpoint()
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.healthService.ready();

    // Must be a non-2xx when a dependency is down, or the orchestrator keeps
    // routing traffic to an instance that cannot serve it.
    res.status(
      report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return report;
  }
}
