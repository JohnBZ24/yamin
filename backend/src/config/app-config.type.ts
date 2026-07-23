export type AppConfig = {
  nodeEnv: string;
  name: string;
  workingDirectory: string;
  adminDomain?: string;
  frontendDomain?: string;
  backendDomain: string;
  port: number;
  apiPrefix: string;
  fallbackLanguage: string;
  headerLanguage: string;
  /**
   * IANA timezone used to interpret a spoken reminder time ("remind me at
   * 2:43") when the client didn't send its own. The server runs in UTC and has
   * no other way to know what "2:43" means in wall-clock terms.
   */
  defaultTimezone: string;
};
