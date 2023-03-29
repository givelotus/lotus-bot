import { Telegram, TelegramMessage } from './telegram';
import { Twitter, TwitterMessage } from './twitter';
import { Discord, DiscordMessage } from './discord';

export const Platforms = {
  telegram: Telegram,
  twitter: Twitter,
  discord: Discord
};
export type PlatformName = keyof typeof Platforms;
export type PlatformMessage =
  | TelegramMessage
  | TwitterMessage
  | DiscordMessage;

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
  on(event: 'Balance', callback: (
    platform: PlatformName,
    platformId: string,
    message?: DiscordMessage
  ) => void): this;
  on(event: 'Give', callback: (
    platform: PlatformName,
    chatId: string,
    replyToMessageId: number,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string,
    message?: PlatformMessage
  ) => void): this;
  on(event: 'Deposit', callback: (
    platform: PlatformName,
    platformId: string,
    message?: PlatformMessage
  ) => void): this;
  on(event: 'Withdraw', callback: (
    platform: PlatformName,
    platformId: string,
    wAmount: number,
    wAddress: string,
    message?: PlatformMessage
  ) => void): this;
  on(event: 'Link', callback: (
    platform: PlatformName,
    platformId: string,
    secret: string | undefined,
    message?: PlatformMessage
  ) => void): this;
  on(event: 'Backup', callback: (
    platform: PlatformName,
    platformId: string,
    message?: PlatformMessage
  ) => void): this;
  /**
   * Send reply to the `balance` command to `platformId`  
   * Optionally use the `PlatformMessage` object to send reply
   */
  sendBalanceReply: (
    platformId: string,
    balance: string,
    message?: PlatformMessage
   ) => Promise<void>;
   /**
    * Send reply to the `deposit` command to `platformId`  
    * Optionally use the `PlatformMessage` object to send reply
    */
  sendDepositReply: (
    platformId: string,
    address: string,
    message?: PlatformMessage
  ) => Promise<void>;
  /**
   * Send notification to `platformId` when new deposit received in Chronik API
   */
  sendDepositReceived: (
    platformId: string,
    txid: string,
    amount: string,
    balance: string
  ) => Promise<void>;
  /**
   * Send reply to the `give` command to `chatId`  
   * Optionally use the `PlatformMessage` object to send reply
   */
  sendGiveReply: (
    chatId: string,
    replyToMessageId: number,
    fromUsername: string,
    toUsername: string,
    txid: string,
    amount: string,
    message?: PlatformMessage
  ) => Promise<void>;
  /**
   * Send reply to the `withdraw` command to `platformId`  
   * Optionally use the `PlatformMessage` object to send reply
   */
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
    },
    message?: PlatformMessage
  ) => Promise<void>;
  /**
   * Send reply to the `balance` command to `platformId`  
   * Optionally use the `PlatformMessage` object to send reply
   */
  sendLinkReply: (
    platformId: string,
    { error, secret }: { error?: string, secret?: string },
    message?: PlatformMessage
  ) => Promise<void>;
  /**
   * Send reply to the `backup` command to `platformId`  
   * Optionally use the `PlatformMessage` object to send reply
   */
  sendBackupReply: (
    platformId: string,
    mnemonic: string,
    message?: PlatformMessage
  ) => Promise<void>;
};