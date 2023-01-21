import { Telegram } from './telegram';
import { Twitter } from './twitter';

export { Telegram, Twitter };
export type PlatformDatabaseTable = 'userTelegram' | 'userTwitter';

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
  /** EventEmitter handlers */
  on: (event: string, callback: (...params: any) => void) => this;
  getBotId: () => string;
  sendBalanceReply: (platformId: string, balance: string) => Promise<void>;
  sendDepositReply: (platformId: string, address: string) => Promise<void>;
  sendDepositReceived: (
    platformId: string,
    txid: string,
    amount: string
  ) => Promise<void>;
  sendDepositConfirmed: (
    platformId: string,
    txid: string,
    amount: string,
    balance: string
  ) => Promise<void>;
  sendGiveReply: (
    chatId: string,
    replyToMessageId: number,
    fromUsername: string,
    toUsername: string,
    amount: string
  ) => Promise<void>;
  sendWithdrawReply: (
    platformId: string,
    {
      txid,
      amount,
      error
    }: {
      txid?: string,
      amount?: string,
      error?: string
    }
  ) => Promise<void>;
};