/** App origins that may wake the push worker from a signed-in browser. */
const APP_ORIGINS = [
  'https://dado211207.github.io',
  'https://boka-operativa-phone-test.netlify.app',
  'https://firenexa-app.netlify.app',
] as const;

/** ALLOWED_ORIGIN remains an optional additional origin for an installation. */
export function isAllowedOrigin(origin: string, configuredOrigin?: string): boolean {
  return APP_ORIGINS.some((allowed) => allowed === origin) ||
    (configuredOrigin !== undefined && configuredOrigin.length > 0 && origin === configuredOrigin);
}

export function responseOrigin(origin: string | null, configuredOrigin?: string): string {
  return origin !== null && isAllowedOrigin(origin, configuredOrigin) ? origin : APP_ORIGINS[0];
}
