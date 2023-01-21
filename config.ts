import dotenv from 'dotenv';

type ParsedConfig = {
  apiKeys: {
    Telegram: string,
    Twitter: string,
  },
  wallet: {
    chronikUrl: string,
    explorerUrl: string,
  }
  dbUrl: string
};

class Config {
  constructor() {
    dotenv.config();
  };

  get parsedConfig() {
    return this.parseConfig();
  };

  private parseConfig = (): ParsedConfig => {
    return {
      apiKeys: {
        Telegram: process.env.APIKEY_TELEGRAM,
        Twitter: process.env.APIKEY_TWITTER,
      },
      wallet: {
        chronikUrl: process.env.WALLET_CHRONIK_URL,
        explorerUrl: process.env.WALLET_EXPLORER_URL
      },
      dbUrl: process.env.DATABASE_URL,
    };
  };
};

const config = new Config();
export default config.parsedConfig;
