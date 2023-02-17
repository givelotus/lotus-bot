import { EventEmitter } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { format } from 'node:util';
import {
  Context,
  Telegraf,
} from "telegraf";
import { Platform } from '.';
import { BOT } from '../../util/constants';
import { split } from '../../util';
import config from '../../config'
import { Message } from "telegraf/typings/core/types/typegram";

export type TelegramMessage = Context;

const REPLIES_PER_SECOND = 20;
const parseGive = (
  text: string
) => {
  const parts = split(text);
  const index = parts.findIndex(part => part.toLowerCase() == '/give');
  return index >= 0
    ? parts.slice(index + 1, index + 2).pop()
    : null;
};
const parseWithdraw = (
  text: string
) => {
  const parts = split(text);
  const index = parts.findIndex(part => part.toLowerCase() == '/withdraw');
  return index >= 0
    ? parts.slice(index + 1, index + 3)
    : null;
};
const parseLink = (
  text: string
) => {
  const parts = split(text);
  const index = parts.findIndex(part => part.toLowerCase() == '/link');
  return index >= 0
    ? parts.slice(index + 1, index + 2).pop()
    : undefined;
};
const escape = (
  text: string
) => text.replace(/(_)/g, "\\$1");

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
    this.bot.command('give', this._handleGroupMessage);
    this.bot.command('balance', this._handleDirectMessage);
    this.bot.command('deposit', this._handleDirectMessage);
    this.bot.command('withdraw', this._handleDirectMessage);
    this.bot.command('link', this._handleDirectMessage);
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
    txid: string,
    amount: string,
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      const fromUsernameEscaped = escape(fromUsername);
      const toUsernameEscaped = escape(toUsername);
      const msg = format(
        BOT.MESSAGE.GIVE,
        fromUsernameEscaped,
        amount,
        toUsernameEscaped,
        `${config.wallet.explorerUrl}/tx/${txid}`
      );
      await this.bot.telegram.sendMessage(chatId, msg, {
        reply_to_message_id: replyToMessageId,
        parse_mode: 'Markdown'
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
    amount: string,
    balance: string,
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      const msg = format(
        BOT.MESSAGE.DEPOSIT_RECV,
        amount,
        balance,
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

  sendLinkReply = async (
    platformId: string,
    { error, secret }: { error?: string, secret?: string },
  ) => {
    try {
      await setTimeout(this._calcReplyDelay());
      switch (typeof secret) {
        case 'string':
          const msg = format(BOT.MESSAGE.LINK, secret);
          await this.bot.telegram.sendMessage(platformId, msg,
            { parse_mode: 'Markdown' }
          );
          break;
        case 'undefined':
          await this.bot.telegram.sendMessage(
            platformId,
            error
              ? format(BOT.MESSAGE.LINK_FAIL, error)
              : BOT.MESSAGE.LINK_OK
          );
          break;
      }
      this.lastReplyTime = Date.now();
    } catch (e: any) {
      throw new Error(`sendLinkReply: ${e.message}`);
    }
  };

  private _handleDirectMessage = async (
    ctx: TelegramMessage
  ) => {
    try {
      if (ctx.chat.type !== 'private') {
        return await ctx.sendMessage(
          BOT.MESSAGE.ERR_DM_COMMAND,
          { reply_to_message_id: ctx.message.message_id }
        );
      }
      const platformId = ctx.message.from.id.toString();
      const messageText = <string>(<any>ctx.message).text;
      const command = messageText.split(' ').shift();
      switch (command) {
        case '/deposit':
          return this.emit('Deposit', 'telegram', platformId);
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
          return this.emit(
            'Withdraw',
            'telegram',
            platformId,
            wAmount,
            wAddress
          );
        case '/balance':
          return this.emit('Balance', 'telegram', platformId);
        case '/link':
          const secret = parseLink(messageText);
          return this.emit('Link', 'telegram', platformId, secret);
        case '/start':
          return ctx.sendMessage(
            `Welcome to my home! ` +
          `I can help you deposit Lotus and give Lotus to other users.\r\n\r\n` +
          `Please see the Menu for available commands.`
          );
        default:
          return ctx.sendMessage(
            `Command \`${command}\` is not supported.`,
            { parse_mode: 'Markdown' }
          )
      }
    } catch (e: any) {
      throw new Error(`_handleDirectMessage: ${e.message}`);
    }
  };

  private _handleGroupMessage = async (
    ctx: TelegramMessage
  ) => {
    try {
      const replyToMessageId = ctx.message.message_id;
      if (ctx.message.chat.type == 'private') {
        return await ctx.sendMessage(
          BOT.MESSAGE.ERR_NOT_DM_COMMAND,
          { reply_to_message_id: replyToMessageId }
        );
      }
      const chatId = ctx.message.chat.id;
      const fromId = ctx.message.from.id;
      const fromUsername = ctx.message.from.username || 'no username';
      const repliedMessage = <Message>(<any>ctx.message).reply_to_message;
      const toId = repliedMessage?.from?.id;
      const toUsername = repliedMessage?.from?.username || 'no username';
      const messageText = <string>(<any>ctx.message).text;
      const command = messageText.split(' ').shift();
      switch (command) {
        case '/give':
          if (!toId || fromId == toId) {
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
          return this.emit(
            'Give',
            'telegram', 
            chatId,
            replyToMessageId,
            fromId.toString(),
            fromUsername,
            toId.toString(),
            toUsername,
            amount
          );
      }
    } catch (e: any) {
      throw new Error(`_handleGroupMessage: ${e.message}`);
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
