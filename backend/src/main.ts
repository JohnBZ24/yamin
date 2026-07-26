import { NestFactory, Reflector } from '@nestjs/core';
import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import { useContainer } from 'class-validator';
import { ConfigService } from '@nestjs/config';

import { ApiModule } from './api.module';
import { AllConfigType } from './config/config.type';
import { validationOptions } from './utils/helpers';
import { ResponseTransformInterceptor } from './utils/interceptors/transform.interceptor';
import { ErrorHandlingInterceptor } from './utils/interceptors/error.interceptor';
import { ResolvePromisesInterceptor } from './utils/interceptors/serializer.interceptor';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { resolveCorsOptions } from './utils/cors';
import {
  createSwaggerDocumentBuilder,
  getSwaggerDarkCss,
  swaggerOptions,
} from './swagger-ui/swagger.config';

/**
 * Entrypoint for the API instance only. The worker has its own entrypoint
 * (main.worker.ts) and its own root module — this file no longer branches on
 * RUN_MODE, because a branch that loaded the same module either way was what
 * let the API quietly keep consuming jobs.
 */
async function bootstrap() {
  const app = await NestFactory.create(ApiModule);
  const logger = new Logger('Api');

  useContainer(app.select(ApiModule), { fallbackOnErrors: true });
  const configService = app.get(ConfigService<AllConfigType>);

  // Lets Nest run onModuleDestroy/onApplicationShutdown on SIGTERM, so the
  // Redis clients and the DB pool close instead of being severed mid-flight.
  app.enableShutdownHooks();

  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: ['/'],
    },
  );

  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.useGlobalPipes(new ValidationPipe(validationOptions));

  app.useGlobalInterceptors(
    // ResolvePromisesInterceptor is used to resolve promises in responses because class-transformer can't do it
    // https://github.com/typestack/class-transformer/issues/549
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
    new ResponseTransformInterceptor(),
    new ErrorHandlingInterceptor(),
  );

  app.use(bodyParser.json({ limit: '50mb' })); // Set the limit to 50MB or any size you need
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors(resolveCorsOptions(configService, logger));

  // Rooms must be backed by Redis before any socket connects, otherwise the
  // worker's emits reach nothing.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(
    configService.getOrThrow('redis', { infer: true }),
  );
  app.useWebSocketAdapter(redisIoAdapter);

  // The full API surface has no business being enumerable on a production
  // box; /docs exists for local dev and staging only.
  const nodeEnv = configService.get('app.nodeEnv', { infer: true });
  if (nodeEnv !== 'production') {
    const options = createSwaggerDocumentBuilder();
    const document = SwaggerModule.createDocument(app, options);
    const swaggerDarkCss = getSwaggerDarkCss();

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions,
      customCss: swaggerDarkCss,
    });
  }

  const port = configService.getOrThrow('app.port', { infer: true });
  await app.listen(port);
  logger.log(`API instance listening on port ${port}`);
}

void bootstrap();
