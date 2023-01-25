import { EventEmitter } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { format } from 'node:util';
import {
  Context,
  Telegraf,
} from "telegraf";
import { Platform } from '.';
import { BOT } from '../../util/constants';
import {
  parseGive,
  parseWithdraw
} from '../../util';
import config from '../../config'
import { Message } from "telegraf/typings/core/types/typegram";

export type TelegramMessage = Context;

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
      const msg = format(
        BOT.MESSAGE.GIVE,
        fromUsername,
        amount,
        toUsername
      );
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
      const msg = format(BOT.MESSAGE.BALANCE, balance);
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
      const msg = format(
        BOT.MESSAGE.DEPOSIT,
        address,
        `${config.wallet.explorerUrl}/address/${address}`
      );
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
      const msg = format(
        BOT.MESSAGE.DEPOSIT_RECV,
        amount,
        `${config.wallet.explorerUrl}/tx/${txid}`
      );
      await this.bot.telegram.sendMessage(platformId, msg,
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
      const msg = format(
        BOT.MESSAGE.DEPOSIT_CONF,
        amount,
        balance,
        `${config.wallet.explorerUrl}/tx/${txid}`
      )
      await this.bot.telegram.sendMessage(platformId, msg,
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
        ? format(BOT.MESSAGE.WITHDRAW_FAIL, error)
        : format(
          BOT.MESSAGE.WITHDRAW_OK,
          amount,
          `${config.wallet.explorerUrl}/tx/${txid}`
        );
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
        BOT.MESSAGE.ERR_DM_COMMAND,
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
          BOT.MESSAGE.ERR_NOT_DM_COMMAND,
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
          BOT.MESSAGE.ERR_GIVE_MUST_REPLY_TO_USER,
          { reply_to_message_id: replyToMessageId }
        );
      }
      if (toId == ctx.botInfo.id) {
        return await ctx.sendMessage(
          BOT.MESSAGE.ERR_GIVE_TO_BOT,
          { reply_to_message_id: replyToMessageId }
        )
      }
      const messageText = <string>(<any>ctx.message).text;
      const amount = parseGive(messageText);
      const amountInt = Number(amount);
      if (isNaN(amountInt) || amountInt <= 0) {
        return await ctx.sendMessage(
          BOT.MESSAGE.ERR_AMOUNT_INVALID,
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
