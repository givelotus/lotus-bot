import { EventEmitter } from 'stream';
import { Platform } from '.';

export type TwitterMessage = {

};

export class Twitter
extends EventEmitter
implements Platform {
  setup = async () => {};
  launch = async () => {};
  stop = async () => {};
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