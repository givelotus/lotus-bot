import { Telegram, TelegramMessage } from './telegram';
import { Twitter, TwitterMessage } from './twitter';
import { Discord, DiscordMessage } from './discord';

export { Telegram, Twitter, Discord };
export type PlatformName = 'telegram' | 'twitter' | 'discord';
export type PlatformDatabaseTable = 'userTelegram' | 'userTwitter' | 'userDiscord';
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
    message?: DiscordMessage
  ) => void): this;
  on(event: 'Deposit', callback: (
    platform: PlatformName,
    platformId: string,
    message?: DiscordMessage
  ) => void): this;
  on(event: 'Withdraw', callback: (
    platform: PlatformName,
    platformId: string,
    wAmount: number,
    wAddress: string,
    message?: DiscordMessage
  ) => void): this;
  on(event: 'Link', callback: (
    platform: PlatformName,
    platformId: string,
    secret: string | undefined,
    message?: DiscordMessage
  ) => void): this;
  sendBalanceReply: (
    platformId: string,
    balance: string,
    message?: PlatformMessage
   ) => Promise<void>;
  sendDepositReply: (
    platformId: string,
    address: string,
    message?: PlatformMessage
  ) => Promise<void>;
  sendDepositReceived: (
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
    txid: string,
    amount: string,
    message?: PlatformMessage
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
    },
    message?: PlatformMessage
  ) => Promise<void>;
  sendLinkReply: (
    platformId: string,
    { error, secret }: { error?: string, secret?: string },
    message?: PlatformMessage
  ) => Promise<void>;
};