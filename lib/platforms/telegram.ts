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
import { Handler } from "../handler";

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
implements Platform {
  private bot: Telegraf;
  private handler: Handler;
  private lastReplyTime: number;

  constructor(handler: Handler) {
    this.handler = handler;
    this.lastReplyTime = Date.now();
  }

  setup = async (apiKey: string) => {
    this.bot = new Telegraf(apiKey);
    this.bot.command('give', this.handleGroupMessage);
    this.bot.command('balance', this.handleDirectMessage);
    this.bot.command('deposit', this.handleDirectMessage);
    this.bot.command('withdraw', this.handleDirectMessage);
    this.bot.command('link', this.handleDirectMessage);
    this.bot.command('backup', this.handleDirectMessage);
    this.bot.start(this.handleDirectMessage);
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
  notifyUser = async (
    platformOrChatId: string | number,
    msg: string,
    replyToMessageId?: number,
  ) => {
    try {
      await this.bot.telegram.sendMessage(
        platformOrChatId,
        msg,
        {
          parse_mode: 'Markdown',
          reply_to_message_id: replyToMessageId
        }
      );
    } catch (e: any) {
      this.handler.log(
        `telegram`,
        `failed to notify user: ${e.message}`
      );
    }
  };

  sendDepositReceived = async (
    platformId: string,
    txid: string,
    amount: string,
    balance: string,
  ) => {
    try {
      await setTimeout(this.calcReplyDelay());
      const msg = format(
        BOT.MESSAGE.DEPOSIT_RECV,
        amount,
        balance,
        `${config.wallet.explorerUrl}/tx/${txid}`
      );
      await this.notifyUser(platformId, msg);
    } catch (e: any) {
      throw new Error(`sendDepositReceived: ${e.message}`);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleBalanceCommand = async (
    platformId: string
  ) => {
    try {
      const balance = await this.handler.processBalanceCommand(
        'telegram',
        platformId
      );
      const msg = format(BOT.MESSAGE.BALANCE, balance);
      await this.notifyUser(platformId, msg);
      await setTimeout(this.calcReplyDelay());
    } catch (e: any) {
      this.handler.log('telegram', e.message);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleDepositCommand = async (
    platformId: string
  ) => {
    try {
      const address = await this.handler.processDepositCommand(
        'telegram',
        platformId
      );
      const msg = format(
        BOT.MESSAGE.DEPOSIT,
        address,
        `${config.wallet.explorerUrl}/address/${address}`
      );
      await setTimeout(this.calcReplyDelay());
      await this.notifyUser(platformId, msg);
    } catch (e: any) {
      this.handler.log('telegram', e.message);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleGiveCommand = async (
    chatId: number,
    replyToMessageId: number,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string
  ) => {
    try {
      const { txid, amount } = await this.handler.processGiveCommand(
        'telegram',
        fromId,
        fromUsername,
        toId,
        toUsername,
        value
      );
      const fromUsernameEscaped = escape(fromUsername);
      const toUsernameEscaped = escape(toUsername);
      const msg = format(
        BOT.MESSAGE.GIVE,
        fromUsernameEscaped,
        amount,
        toUsernameEscaped,
        `${config.wallet.explorerUrl}/tx/${txid}`
      );
      await setTimeout(this.calcReplyDelay());
      await this.notifyUser(chatId, msg, replyToMessageId);
    } catch (e: any) {
      this.handler.log('telegram', e.message);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleWithdrawCommand = async (
    platformId: string,
    outAmount: string,
    outAddress: string,
  ) => {
    try {
      const result = await this.handler.processWithdrawCommand(
        'telegram',
        platformId,
        outAmount,
        outAddress
      );
      const msg = typeof result == 'string'
        ? format(BOT.MESSAGE.WITHDRAW_FAIL, result)
        : format(
          BOT.MESSAGE.WITHDRAW_OK,
          result.amount,
          `${config.wallet.explorerUrl}/tx/${result.txid}`
        );
      await setTimeout(this.calcReplyDelay());
      await this.notifyUser(platformId, msg);
    } catch (e: any) {
      this.handler.log('telegram', e.message);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleLinkCommand = async (
    platformId: string,
    secret: string | undefined,
  ) => {
    try {
      const result = await this.handler.processLinkCommand(
        'telegram',
        platformId,
        secret
      );
      await setTimeout(this.calcReplyDelay());
      if (typeof result == 'string') {
        await this.bot.telegram.sendMessage(
          platformId,
          format(BOT.MESSAGE.LINK_FAIL, result)
        );
        throw new Error(result);
      }
      const msg = typeof result.secret == 'string'
        ? format(BOT.MESSAGE.LINK, result.secret)
        : BOT.MESSAGE.LINK_OK;
      await this.notifyUser(platformId, msg);
    } catch (e: any) {
      this.handler.log('telegram', e.message);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleBackupCommand = async (
    platformId: string,
  ) => {
    try {
      const mnemonic = await this.handler.processBackupCommand(
        'telegram',
        platformId
      );
      await setTimeout(this.calcReplyDelay());
      await this.notifyUser(platformId, format(BOT.MESSAGE.BACKUP, mnemonic));
    } catch (e: any) {
      this.handler.log('telegram', `handleBackupCommand: ${e.message}`);
    } finally {
      this.lastReplyTime = Date.now();
    }
  };

  private handleDirectMessage = async (
    ctx: Context
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
          return this.handleDepositCommand(platformId);
        case '/withdraw':
          const [ outAmount, outAddress ] = parseWithdraw(messageText);
          if (!outAmount || !outAddress) {
            return ctx.sendMessage(
              `Syntax: \`/withdraw amount address\`\r\n`,
              { parse_mode: 'Markdown' }
            );
          }
          if (Number(outAmount) <= 0 || isNaN(Number(outAmount))) {
            return ctx.sendMessage(
              `Invalid amount specified.`,
              { parse_mode: 'Markdown' }
            );
          }
          return this.handleWithdrawCommand(
            platformId,
            outAmount,
            outAddress
          );
        case '/balance':
          return this.handleBalanceCommand(platformId);
        case '/link':
          const secret = parseLink(messageText);
          return this.handleLinkCommand(platformId, secret);
        case '/backup':
          return this.handleBackupCommand(platformId);
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
      throw new Error(`handleDirectMessage: ${e.message}`);
    }
  };

  private handleGroupMessage = async (
    ctx: Context
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
      const fromUsername =
        ctx.message.from.username ||
        ctx.message.from.first_name;
      const repliedMessage = <Message>(<any>ctx.message).reply_to_message;
      const toId = repliedMessage?.from?.id;
      const toUsername =
        repliedMessage?.from?.username ||
        repliedMessage?.from?.first_name;
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
          return this.handleGiveCommand(
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

  private calcReplyDelay = () => {
    const now = Date.now();
    const delay = Math.floor(
      (1000 / REPLIES_PER_SECOND) - (now - this.lastReplyTime)
    );
    return delay < 0 ? 0 : delay;
  };
  
};
