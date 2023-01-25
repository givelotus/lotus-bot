import { PrismaClient } from "../prisma/prisma-client-js";
import { PlatformDatabaseTable } from "./platforms";
import { AccountUtxo } from "./wallet";
import * as Util from '../util';
import { BOT } from "../util/constants";

type Deposit = AccountUtxo & {
  timestamp: Date,
  confirmed?: boolean
};

type Give = {
  id: string,
  platform: string,
  timestamp: Date,
  fromId: string,
  toId: string,
  value: string
};

type Withdrawal = {
  txid: string,
  value: string,
  timestamp: Date,
  userId: string
};

export class Database {
  private prisma: PrismaClient;
  private platform: string;
  private platformTable: PlatformDatabaseTable;

  constructor(platform: string) {
    this.prisma = new PrismaClient();
    this.platform = platform.toLowerCase();
    switch (platform) {
      case 'Telegram':
        this.platformTable = 'userTelegram';
        break;
      case 'Twitter':
        this.platformTable = 'userTwitter';
        break;
      case 'Discord':
        this.platformTable = 'userDiscord';
        break;
    }
  };

  connect = async () => await this.prisma.$connect();
  disconnect = async () => await this.prisma.$disconnect();

  botUserExists = async () => {
    try {
      const result = await this.prisma.user.findFirst({
        where: { id: BOT.UUID }
      });
      return result?.id ? true : false;
    } catch (e: any) {

    }
  };

  /** Check to make sure deposit exists. Used when confirming deposits. */
  isValidDeposit = async (
    txid: string
  ): Promise<boolean> => {
    try {
      const result = await this.prisma.deposit.findFirst({
        where: { txid },
        select: { txid: true }
      });
      return result?.txid ? true : false;
    } catch (e: any) {
      throw new Error(`isValidDeposit: ${e.message}`);
    }
  };

  /** Check db to ensure `userId` exists */
  isValidUser = async (
    platformId: string
  ): Promise<boolean> => {
    try {
      const result = await this.prisma[this.platformTable].findFirst({
        where: { id: platformId }
      });
      return result?.userId ? true : false;
    } catch (e: any) {
      throw new Error(`isValidUser: ${e.message}`);
    }
  };
  getBotWalletKey = async () => {
    try {
      const result = await this.prisma.walletKey.findFirst({
        where: { userId: BOT.UUID }
      });
      return {
        userId: result.userId,
        hdPrivKey: result.hdPrivKey
      };
    } catch (e: any) {
      throw new Error(`getBotWalletKey: ${e.message}`);
    }
  };
  /** Get WalletKeys for all platform users */
  getPlatformWalletKeys = async () => {
    try {
      const result = await this.prisma[this.platformTable].findMany({
        select: { user: {
          select: { id: true, key: {
            select: { hdPrivKey: true }
          }}
        }}
      });
      return result.map(({ user }) => {
        return {
          userId: user.id,
          hdPrivKey: user.key.hdPrivKey
        };
      });
    } catch (e: any) {
      throw new Error(`getAllWalletKeys: ${e.message}`);
    }
  };
  /** Get all deposits or all unconfirmed deposits of platform users */
  getPlatformDeposits = async ({
    unconfirmed = false
  }: {
    unconfirmed?: boolean
  }) => {
    try {
      const result = await this.prisma[this.platformTable].findMany({
        select: { user: {
          select: { deposits: {
            where: unconfirmed ? { confirmed: false } : undefined
          }}
        }}
      });
      const deposits: Deposit[] = [];
      for (const { user } of result) {
        deposits.push(...user.deposits);
      }
      return deposits;
    } catch (e: any) {
      throw new Error(`getAllDeposits: ${e.message}`);
    }
  };
  /**
   * Get total account balance for the `platformId`  
   * Total balance includes all associated users of the account
   */
  getAccountBalance = async (
    platformId: string
  ) => {
    try {
      const sats = { total: 0 };
      const accountId = await this.getAccountId(platformId);
      const { users } = await this.prisma.account.findFirst({
        where: { id: accountId },
        select: { users: { 
          select: {
            deposits: {
              where: { confirmed: true },
              select: { value: true }
            },
            withdrawals: { select: { value: true }},
            gives: { select: { value: true }},
            receives: { select: { value: true }}
          }
        }}
      });
      for (const { deposits, withdrawals, gives, receives } of users) {
        deposits.forEach(d => sats.total += Number(d.value));
        receives.forEach(r => sats.total += Number(r.value));
        withdrawals.forEach(w => sats.total -= Number(w.value));
        gives.forEach(g => sats.total -= Number(g.value));
      }
      return sats.total;
    } catch (e: any) {
      throw new Error(`getAccountBalance: ${e.message}`);
    }
  };
  /** Get the `accountId` for the specified `platformId` */
  getAccountId = async (
    platformId: string
  ) => {
    try {
      const result = await this.prisma[this.platformTable].findFirst({
        where: { id: platformId },
        select: { user: { 
          select: { accountId: true }
        }}
      });
      return result.user.accountId;
    } catch (e: any) {
      throw new Error(`getAccountId: ${e.message}`);
    }
  };
  /** Get the `userId` for the specified `platformId` */
  getUserId = async (
    platformId: string
  ) => {
    try {
      const result = await this.prisma[this.platformTable].findFirst({
        where: { id: platformId },
        select: { userId: true }
      });
      return result.userId;
    } catch (e: any) {
      throw new Error(`getUserId: ${e.message}`);
    }
  };
  /**
   * Save new `Account` to the database  
   * Also saves all associated data (e.g. Platform, WalletKey, etc.)
   */
  saveAccount = async ({
    accountId,
    userId,
    platform,
    platformId,
    mnemonic,
    hdPrivKey,
    hdPubKey
  }: {
    accountId: string,
    userId: string,
    platform?: string,
    platformId?: string,
    mnemonic: string,
    hdPrivKey: string,
    hdPubKey: string
  }) => {
    try {
      const privKeyBytes = Buffer.from(hdPrivKey);
      const pubKeyBytes = Buffer.from(hdPubKey);
      const account = {
        id: accountId,
        users: { create: {
          id: userId,
          secret: Util.newUUID(),
          key: {
            create: {
              mnemonic,
              hdPrivKey: privKeyBytes,
              hdPubKey: pubKeyBytes
            }
          },
        }}
      };
      if (platform && platformId) {
        account.users.create[this.platform] = { create: {
          id: platformId
        }};
      }
      return await this.prisma.account.create({ data: account });
    } catch (e: any) {
      throw new Error(`saveAccount: ${e.message}`);
    }
  };
  /** For linking one user with another user by `accountId` */
  updateUserAccountId = async ({
    userId,
    accountId
  }: {
    userId: string,
    accountId: string
  }) =>{
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { accountId }
      });
    } catch (e: any) {
      throw new Error(`updateUserAccountId: ${e.message}`);
    }
  };
  /**
   * Save the deposit received as UTXO from Chronik API  
   * Return the `platformId`s to notify the user
   */
  saveDeposit = async (
    data: Deposit
  ) => {
    try {
      const result = await this.prisma.deposit.create({
        data,
        select: { user: {
          select: {
            telegram: true,
            twitter: true,
            discord: true
          }
        }}
      });
      return result;
    } catch (e: any) {
      throw new Error(`saveDeposit: ${e.message}`);
    }
  };
  saveGive = async (
    data: Give
  ) => {
    try {
      await this.prisma.give.create({ data });
    } catch (e: any) {
      throw new Error(`saveGive: ${e.message}`);
    }
  };
  saveWithdrawal = async (
    data: Withdrawal
  ) => {
    try {
      await this.prisma.withdrawal.create({ data });
    } catch (e: any) {
      throw new Error(`saveWithdrawal: ${e.message}`);
    }
  };
  /**
   * Confirm the deposit after notification from Chronik API  
   * Return the `platformId`s to notify the user
   */
  confirmDeposit = async (
    txid: string
  ) => {
    try {
      const result = await this.prisma.deposit.update({
        where: { txid },
        data: { confirmed: true },
        select: { value: true, user: {
          select: {
            telegram: true,
            twitter: true,
            discord: true
          }
        }}
      });
      return result;
    } catch (e: any) {
      throw new Error(`confirmDeposit: ${e.message}`);
    }
  };

  private _execTransaction = async (
    inserts: any[]
  ) => {
    try {
      return await this.prisma.$transaction(inserts);
    } catch (e: any) {
      throw new Error(`_execTransaction: ${e.message}`);
    }
  };
};