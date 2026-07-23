import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { REALTIME_NOTIFIER } from './realtime.constants';
import { RedisEmitterNotifier } from './redis-emitter.notifier';
import { PushService } from './push.service';

/**
 * Deliberately declares NO controllers: this module is imported by the worker
 * as well as the API, and the worker serves no HTTP. The push-registration
 * endpoint lives in RealtimeApiModule instead.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    { provide: REALTIME_NOTIFIER, useClass: RedisEmitterNotifier },
    PushService,
  ],
  exports: [REALTIME_NOTIFIER, PushService],
})
export class RealtimeModule {}
