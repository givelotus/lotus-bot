import { EventEmitter } from "node:stream";
import { setTimeout } from "node:timers/promises";
import {
  Context,
  Telegraf,
} from "telegraf";
import { Platform } from '.';
import {
  parseGive,
  parseWithdraw
} from '../../util';
import config from '../../config'
import { Message } from "telegraf/typings/core/types/typegram";

const ERR_DM_REQUIRED =
  'Please send me this command in a DM';
const ERR_GIVE_NOT_DM_COMMAND =
  'This command does not work in a DM';
const ERR_GIVE_MUST_REPLY_TO_OTHER_USER =
  'You must reply to another user to give Lotus';
const ERR_GIVE_AMOUNT_INVALID =
  'Invalid amount specified';
const ERR_GIVE_TO_BOT =
  'I appreciate the thought, but you cannot give me Lotus. :)';

export declare interface Telegram {
  on(event: 'Balance', callback: (
    platformId: string
  ) => void): this;
  on(event: 'Give', callback: (
    chatId: string,
    replyToMessageId: number,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string
  ) => void): this;
  on(event: 'Deposit', callback: (
    platformId: string,
  ) => void): this;
  on(event: 'Withdraw', callback: (
    platformId: string,
    wAmount: number,
    wAddress: string,
  ) => void): this;
}

const REPLIES_PER_SECOND = 20;

export class Telegram 
extends EventEmitter
implements Platform {
  private bot: Telegraf;
  private lastReplyTime: number;

  constructor() {
    super();
    this.lastReplyTime = Date.now();
  }

  setup = async (apiKey: string) => {
    this.bot = new Telegraf(apiKey);
    this.bot.command('give', this._give);
    this.bot.command('balance', this._handleDirectMessage);
    this.bot.command('deposit', this._handleDirectMessage);
    this.bot.command('withdraw', this._handleDirectMessage);
    this.bot.start(this._handleDirectMessage);
  };
  launch = async () => {
    this.bot.launch();
    // once this promise resolves, bot is active
    // https://github.com/telegraf/telegraf/issues/1749
    await this.bot.telegram.getMe()
  };
  stop = async () => {
    this.bot.stop();
  };
  getBotId = () => this.bot.botInfo?.id.toString();
  sendGiveReply = async (
    chatId: string,
    replyToMessageId: number,
    fromUsername: string,
    toUsername: string,
    amount: string
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      const msg =
        `${fromUsername}, you have given ${amount} XPI ` +
        `to ${toUsername}! 🪷`;
      await this.bot.telegram.sendMessage(chatId, msg, {
        reply_to_message_id: replyToMessageId
      });
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendGiveReply: ${e.message}`);
    }
  };
  /** Send user their balance after calculating in LotusBot class */
  sendBalanceReply = async (
    platformId: string,
    balance: string,
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      const msg = `Your balance is ${balance} XPI`;
      await this.bot.telegram.sendMessage(platformId, msg);
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendBalanceReply: ${e.message}`);
    }
  };
  /** Send user their address after gathering in LotusBot class */
  sendDepositReply = async (
    platformId: string,
    address: string,
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      const msg =
        `Send Lotus here to fund your account: \`${address}\`\r\n\r\n` +
        `[View address on the Explorer]` +
        `(${config.wallet.explorerUrl}/address/${address})`;
      await this.bot.telegram.sendMessage(platformId, msg,
        { parse_mode: 'Markdown' }
      );
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendDepositReply: ${e.message}`)
    }
  };

  sendDepositReceived = async (
    platformId: string,
    txid: string,
    amount: string
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      await this.bot.telegram.sendMessage(
        platformId,
        `I received your deposit of ${amount} XPI. ` +
        `I will let you know when it confirms.\r\n\r\n` +
        `[View tx on the Explorer](${config.wallet.explorerUrl}/tx/${txid})`,
        { parse_mode: 'Markdown' }
      );
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendDepositReceived: ${e.message}`);
    }
  };

  sendDepositConfirmed = async (
    platformId: string,
    txid: string,
    amount: string,
    balance: string,
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      await this.bot.telegram.sendMessage(
        platformId,
        `Your deposit of ${amount} XPI has been confirmed! ` + 
        `Your balance is now ${balance} XPI\r\n\r\n` +
        `[View tx on the Explorer](${config.wallet.explorerUrl}/tx/${txid})`,
        { parse_mode: 'Markdown' }
      );
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendDepositConfirmed: ${e.message}`);
    }
  };

  sendWithdrawReply = async (
    platformId: string,
    { txid, amount, error }: { txid?: string, amount?: string, error?: string},
    // ctx: Context
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      const msg = error
        ? `There was an error with your withdrawal: \`${error}\``
        : `Withdrawal of ${amount} XPI successful!\r\n\r\n` +
          `[View tx on the Explorer](${config.wallet.explorerUrl}/tx/${txid})`;
      await this.bot.telegram.sendMessage(platformId, msg,
        { parse_mode: 'Markdown' }
      );
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendWithdrawReply: ${e.message}`);
    }
    
  };

  private _handleDirectMessage = async (
    ctx: Context
  ) => {
    if (ctx.chat.type !== 'private') {
      return await ctx.sendMessage(
        ERR_DM_REQUIRED,
        { reply_to_message_id: ctx.message.message_id }
      );
    }
    const reply = { msg: '' };
    const platformId = ctx.message.from.id.toString();
    const messageText = <string>(<any>ctx.message).text;
    const command = messageText.split(' ').shift();
    switch (command) {
      case '/deposit':
        return this.emit('Deposit', platformId);
      case '/withdraw':
        const [ wAmount, wAddress ] = parseWithdraw(messageText);
        if (!wAmount || !wAddress) {
          return ctx.sendMessage(
            `Syntax: \`/withdraw <amount> <address>\``,
            { parse_mode: 'Markdown' }
          );
        }
        if (Number(wAmount) <= 0) {
          return ctx.sendMessage(
            `Invalid amount \`wAmount\` specified.`,
            { parse_mode: 'Markdown' }
          );
        }
        return this.emit('Withdraw', platformId, wAmount, wAddress);
      case '/balance':
        return this.emit('Balance', platformId);
      case '/start':
        reply.msg = `Welcome to my home! ` +
        `I can help you deposit Lotus and give Lotus to other users.\r\n\r\n` +
        `Please see the Menu for available commands.`;
        return ctx.sendMessage(reply.msg);
      default:
        return ctx.sendMessage(
          `Command \`${command}\` is not supported.`,
          { parse_mode: 'Markdown' }
        )
    }
  };
  
  private _give = async (
    ctx: Context
  ) => {
    try {
      const chatId = ctx.message.chat.id;
      const replyToMessageId = ctx.message.message_id;
      if (ctx.message.chat.type == 'private') {
        return await ctx.sendMessage(
          ERR_GIVE_NOT_DM_COMMAND,
          { reply_to_message_id: replyToMessageId }
        );
      }
      const { id: fromId, username: fromUsername } = ctx.message.from;
      const repliedMessage = <Message>(<any>ctx.message).reply_to_message;
      const toId = repliedMessage?.from?.id;
      const toUsername = repliedMessage?.from?.username;
      if (
        !toId ||
        !toUsername || 
        fromId == toId
      ) {
        return await ctx.sendMessage(
          ERR_GIVE_MUST_REPLY_TO_OTHER_USER,
          { reply_to_message_id: replyToMessageId }
        );
      }
      if (toId == ctx.botInfo.id) {
        return await ctx.sendMessage(
          ERR_GIVE_TO_BOT,
          { reply_to_message_id: replyToMessageId }
        )
      }
      const messageText = <string>(<any>ctx.message).text;
      const amount = parseGive(messageText);
      const amountInt = Number(amount);
      if (isNaN(amountInt) || amountInt <= 0) {
        return await ctx.sendMessage(
          ERR_GIVE_AMOUNT_INVALID,
          { reply_to_message_id: replyToMessageId }
        );
      }
      this.emit('Give',
        chatId,
        replyToMessageId,
        fromId.toString(),
        fromUsername,
        toId.toString(),
        toUsername,
        amount
      );
    } catch (e: any) {
      throw new Error(`_give: ${e.message}`);
    }
  };

  private _calcReplyDelay = () => {
    const now = Date.now();
    const delay = Math.floor(
      (1000 / REPLIES_PER_SECOND) - (now - this.lastReplyTime)
    );
    return delay < 0
      ? 0 
      : delay;
  };
  
};
