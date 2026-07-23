export class ConfigHelper {
  private static instance: ConfigHelper;

  private constructor() {}

  public static getInstance(): ConfigHelper {
    if (!ConfigHelper.instance) {
      ConfigHelper.instance = new ConfigHelper();
    }
    return ConfigHelper.instance;
  }

  public getShowErrorDetails(): boolean {
    return process.env.SHOW_ERROR_DETAILS === 'true';
  }
}
