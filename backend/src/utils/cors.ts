import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import { AllConfigType } from '../config/config.type';

const DEV_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  // Expo Go / RN dev client on a LAN address
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
];

/**
 * The previous config was `origin: '*'` together with `credentials: true`.
 * That pair is invalid under the CORS spec — a browser refuses a credentialed
 * response whose Access-Control-Allow-Origin is the `*` wildcard — so it was
 * simultaneously as permissive as possible on paper and broken in practice for
 * exactly the requests it was meant to allow.
 *
 * Native mobile clients don't enforce CORS at all, so pinning this costs the
 * mobile app nothing; it only governs the web build.
 */
export function resolveCorsOptions(
  configService: ConfigService<AllConfigType>,
  logger: Logger,
): CorsOptions {
  const nodeEnv = configService.get('app.nodeEnv', { infer: true });
  const isProduction = nodeEnv === 'production';

  const configured = [
    ...(process.env.CORS_ORIGINS?.split(',') ?? []),
    configService.get('app.frontendDomain', { infer: true }),
  ]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => !!origin);

  const allowlist = [...new Set(configured)];

  if (isProduction && allowlist.length === 0) {
    throw new Error(
      'No CORS origins configured. Set CORS_ORIGINS (comma-separated) or FRONTEND_DOMAIN before running with NODE_ENV=production.',
    );
  }

  if (!isProduction) {
    logger.warn(
      `CORS: allowing ${allowlist.join(', ') || '(none configured)'} plus localhost — development mode`,
    );
  } else {
    logger.log(`CORS: allowing ${allowlist.join(', ')}`);
  }

  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Same-origin, curl, and native apps send no Origin header at all.
      if (!origin) {
        return callback(null, true);
      }

      if (allowlist.includes(origin)) {
        return callback(null, true);
      }

      if (!isProduction && DEV_ORIGIN_PATTERNS.some((re) => re.test(origin))) {
        return callback(null, true);
      }

      logger.warn(`CORS: rejected origin ${origin}`);
      return callback(null, false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
    credentials: true,
  };
}
