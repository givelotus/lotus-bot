import { Telegram } from './telegram';
import { Twitter } from './twitter';
import { Discord } from './discord';

export const Platforms = {
  telegram: Telegram,
  twitter: Twitter,
  discord: Discord
};
export type PlatformName = keyof typeof Platforms;

export interface Platform {
  /**
   * Instantiate the bot with API key. Also set up event handlers.
   * @param key - API key, as String
   */
  setup: (apiKey: string) => Promise<void>;
  /** Activate the bot */
  launch: () => Promise<void>;
  /** Deactivate the bot */
  stop: () => Promise<void>;
  /**
   * Send notification to `platformId` when new deposit received in Chronik API
   */
  sendDepositReceived: (
    platformId: string,
    txid: string,
    amount: string,
    balance: string
  ) => Promise<void>;
};