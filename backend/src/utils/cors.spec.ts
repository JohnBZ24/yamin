import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { resolveCorsOptions } from './cors';

const logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;

const configWith = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<any>;

/** Resolves the origin callback into a plain boolean for assertions. */
const allows = (options: any, origin: string | undefined): boolean => {
  let allowed = false;
  options.origin(origin, (_err: unknown, ok?: boolean) => {
    allowed = !!ok;
  });
  return allowed;
};

describe('resolveCorsOptions', () => {
  const originalEnv = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalEnv;
  });

  describe('production', () => {
    const prod = () =>
      configWith({
        'app.nodeEnv': 'production',
        'app.frontendDomain': 'https://yamin.app',
      });

    it('allows the configured frontend domain', () => {
      const options = resolveCorsOptions(prod(), logger);
      expect(allows(options, 'https://yamin.app')).toBe(true);
    });

    it('rejects an unknown origin', () => {
      const options = resolveCorsOptions(prod(), logger);
      expect(allows(options, 'https://evil.example')).toBe(false);
    });

    it('does NOT allow localhost in production', () => {
      const options = resolveCorsOptions(prod(), logger);
      expect(allows(options, 'http://localhost:8081')).toBe(false);
    });

    it('throws at boot when no origin is configured', () => {
      delete process.env.CORS_ORIGINS;
      const bare = configWith({ 'app.nodeEnv': 'production' });
      // Failing to boot is correct: silently allowing nothing (or everything)
      // would only be discovered in production, by users.
      expect(() => resolveCorsOptions(bare, logger)).toThrow(/CORS origins/i);
    });

    it('reads a comma-separated CORS_ORIGINS list', () => {
      process.env.CORS_ORIGINS = 'https://a.app, https://b.app';
      const options = resolveCorsOptions(prod(), logger);
      expect(allows(options, 'https://a.app')).toBe(true);
      expect(allows(options, 'https://b.app')).toBe(true);
      expect(allows(options, 'https://c.app')).toBe(false);
    });
  });

  describe('development', () => {
    const dev = () =>
      configWith({
        'app.nodeEnv': 'development',
        'app.frontendDomain': 'https://yamin.app',
      });

    it('allows localhost on any port', () => {
      const options = resolveCorsOptions(dev(), logger);
      expect(allows(options, 'http://localhost:8081')).toBe(true);
      expect(allows(options, 'http://localhost:19006')).toBe(true);
    });

    it('allows a LAN address, for a phone on the same wifi', () => {
      const options = resolveCorsOptions(dev(), logger);
      expect(allows(options, 'http://192.168.1.42:8081')).toBe(true);
    });

    it('still rejects a random public origin', () => {
      const options = resolveCorsOptions(dev(), logger);
      expect(allows(options, 'https://evil.example')).toBe(false);
    });
  });

  it('allows requests with no Origin header (curl, native apps, same-origin)', () => {
    const options = resolveCorsOptions(
      configWith({
        'app.nodeEnv': 'production',
        'app.frontendDomain': 'https://yamin.app',
      }),
      logger,
    );
    expect(allows(options, undefined)).toBe(true);
  });

  it('sets credentials, which is why the origin can never be "*"', () => {
    const options = resolveCorsOptions(
      configWith({
        'app.nodeEnv': 'production',
        'app.frontendDomain': 'https://yamin.app',
      }),
      logger,
    );
    // A wildcard origin with credentials is rejected outright by browsers —
    // the exact combination this file replaced.
    expect(options.credentials).toBe(true);
    expect(options.origin).not.toBe('*');
  });
});
