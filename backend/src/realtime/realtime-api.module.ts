import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { RealtimeModule } from './realtime.module';
import { PushController } from './push.controller';

/**
 * The HTTP surface of the realtime layer — just device registration.
 *
 * Split from RealtimeModule because that one is also imported by the worker,
 * which runs as an application context with no HTTP server. Keeping the
 * controller here means the worker never declares a route it cannot serve.
 */
@Module({
  imports: [RealtimeModule, JwtModule.register({})],
  controllers: [PushController],
})
export class RealtimeApiModule {}
