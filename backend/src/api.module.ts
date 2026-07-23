import { Module } from '@nestjs/common';

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
    UserModule,
    AuthModule,
    HealthModule,
    VoiceApiModule,
    MemoryModule,
    RealtimeApiModule,
  ],
})
export class ApiModule {}
