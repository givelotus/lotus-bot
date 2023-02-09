import dotenv from 'dotenv';

type ParsedConfig = {
  apiKeys: {
    telegram: string,
    twitter: string,
    discord: string
  },
  discord: {
    clientId: string,
    guildId: string
  },
  wallet: {
    chronikUrl: string,
    explorerUrl: string,
  },
  tx: {
    feeRate: number
  },
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
        telegram: process.env.APIKEY_TELEGRAM,
        twitter: process.env.APIKEY_TWITTER,
        discord: process.env.APIKEY_DISCORD
      },
      discord: {
        clientId:process.env.CLIENTID_DISCORD,
        guildId:process.env.GUILDID_DISCORD
      },
      wallet: {
        chronikUrl: process.env.WALLET_CHRONIK_URL,
        explorerUrl: process.env.WALLET_EXPLORER_URL
      },
      tx: {
        feeRate: Number(process.env.TX_FEE_RATE)
      },
      dbUrl: process.env.DATABASE_URL,
    };
  };
};

const config = new Config();
export default config.parsedConfig;
