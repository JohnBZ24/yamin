import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CoreModule } from './core.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { VoiceApiModule } from './voice/voice-api.module';
import { MemoryModule } from './memory/memory.module';
import { RealtimeApiModule } from './realtime/realtime-api.module';

/**
 * Root module for the HTTP + WebSocket instance (the producer).
 *
 * Replaces the old single AppModule, which both RUN_MODE branches loaded. That
 * meant the API imported VoiceModule, which provided VoiceProcessor — so the
 * API was also consuming from the queue and running Whisper/LLM calls on the
 * event loop serving requests. The two-instance split existed on the diagram
 * and in docker-compose but not in the wiring.
 */
@Module({
  imports: [
    CoreModule,
    // Second line of rate limiting behind nginx's limit_req zones: nginx
    // caps per-IP request rates at the edge; this caps them again in-process
    // so a request path that bypasses the proxy (loopback, port-forward) is
    // still bounded. Auth endpoints carry a tighter @Throttle override.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
      },
    ]),
    UserModule,
    AuthModule,
    HealthModule,
    VoiceApiModule,
    MemoryModule,
    RealtimeApiModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class ApiModule {}
