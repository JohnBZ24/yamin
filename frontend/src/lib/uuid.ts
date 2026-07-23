/**
 * `crypto.randomUUID()` is gated behind a secure context. Over plain HTTP on a
 * LAN address — exactly how you test on a phone — it is simply absent, and
 * calling it throws "crypto.randomUUID is not a function", which killed every
 * typed note on a device while working fine on desktop localhost.
 *
 * `crypto.getRandomValues` has no such restriction, so it carries the fallback.
 * The output has to satisfy the API's `@IsUUID()`, so this builds a real RFC
 * 4122 version 4 value rather than any random-looking string.
 */
export function randomUuid(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    // Last resort only. Not cryptographically strong, but these ids just have
    // to be unique per note, and a collision is far less bad than a crash.
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
