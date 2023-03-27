import { PrismaClient } from "../prisma/prisma-client-js";
import { AccountUtxo } from "./wallet";

type Deposit = AccountUtxo & {
  timestamp: Date,
  confirmed?: boolean
};

type Give = {
  txid: string,
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

  constructor() {
    this.prisma = new PrismaClient();
  };
  connect = async () => await this.prisma.$connect();
  disconnect = async () => await this.prisma.$disconnect();
  /**
   * Check if txid is a Give  
   * Used when processing `AddedToMempool` to not save a Give as a Deposit
   */
  isGiveTx = async (
    txid: string
  ) => {
    try {
      const result = await this.prisma.give.findFirst({
        where: { txid },
        select: { txid: true }
      });
      return result?.txid? true : false;
    } catch (e: any) {
      throw new Error(`isGiveTx: ${e.message}`);
    }
  };
  isWithdrawTx = async (
    txid: string
  ) => {
    try {
      const result = await this.prisma.withdrawal.findFirst({
        where: { txid },
        select: { txid: true }
      });
      return result?.txid? true : false;
    } catch (e: any) {
      throw new Error(`isWithdrawTx: ${e.message}`);
    }
  }

  /** Check db to ensure `userId` exists */
  isValidUser = async (
    platform: string,
    platformId: string
  ): Promise<boolean> => {
    const platformTable = this._toPlatformTable(platform);
    try {
      const result = await this.prisma[platformTable].findFirst({
        where: { id: platformId }
      });
      return result?.userId ? true : false;
    } catch (e: any) {
      throw new Error(`isValidUser: ${e.message}`);
    }
  };
  /** Get WalletKeys for all users of all platforms */
  getUserWalletKeys = async () => {
    try {
      const result = await this.prisma.user.findMany({
        select: { id: true, accountId: true, key: {
          select: { hdPrivKey: true }
        }}
      });
      return result.map(user => {
        return {
          accountId: user.accountId,
          userId: user.id,
          hdPrivKey: user.key.hdPrivKey
        }
      });
    } catch (e: any) {
      throw new Error(`getUserWalletKeys: ${e.message}`);
    }
  };
  /** Get Deposits for all users of all platforms */
  getDeposits = async () => {
    try {
      return await this.prisma.deposit.findMany();
    } catch (e: any) {
      throw new Error(`getUserDeposits: ${e.message}`);
    }
  };
  /** Get `userId` and `accountId` for the specified `platformId` */
  getIds = async (
    platform: string,
    platformId: string
  ) => {
    const platformTable = this._toPlatformTable(platform);
    try {
      const result = await this.prisma[platformTable].findFirst({
        where: { id: platformId },
        select: { user: {
          select: { id: true, accountId: true }
        }}
      });
      return {
        accountId: result.user.accountId,
        userId: result.user.id,
      };
    } catch (e: any) {
      throw new Error(`getIds: ${e.message}`);
    }
  };
  getAccountIdFromSecret = async (
    secret: string
  ) => {
    try {
      const result = await this.prisma.user.findFirst({
        where: { secret },
        select: { accountId: true }
      });
      return result?.accountId;
    } catch (e: any) {

    }
  };
  getUserSecret = async (
    platform: string,
    platformId: string
  ) => {
    const platformTable = this._toPlatformTable(platform);
    try {
      const result = await this.prisma[platformTable].findFirst({
        where: { id: platformId },
        select: { user: {
          select: { secret: true }
        }}
      });
      return result.user.secret;
    } catch (e: any) {
      throw new Error(`getUserSecret: ${e.message}`);
    }
  };
  getUserMnemonic = async (
    platform: string,
    platformId: string
  ) => {
    const platformTable = this._toPlatformTable(platform);
    try {
      const result = await this.prisma[platformTable].findFirst({
        where: { id: platformId },
        select: { user: {
          select: { key: {
            select: { mnemonic: true }
          }}
        }}
      });
      return result.user.key.mnemonic;
    } catch (e: any) {
      throw new Error(`getUserMnemonic: ${e.message}`);
    }
  };
  /**
   * Save new `Account` to the database  
   * Also saves all associated data (e.g. Platform, WalletKey, etc.)
   */
  saveAccount = async ({
    accountId,
    userId,
    secret,
    platform,
    platformId,
    mnemonic,
    hdPrivKey,
    hdPubKey
  }: {
    accountId: string,
    userId: string,
    secret: string,
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
          secret,
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
        account.users.create[platform.toLowerCase()] = { create: {
          id: platformId
        }};
      }
      return await this.prisma.account.create({ data: account });
    } catch (e: any) {
      throw new Error(`saveAccount: ${e.message}`);
    }
  };
  /** For linking one user with another user by `accountId` */
  updateUserAccountId = async (
    userId: string,
    accountId: string
  ) =>{
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { accountId },
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
            accountId: true,
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
  deleteGive = async (
    txid: string
  ) => {
    try {
      await this.prisma.give.delete({
        where: { txid }
      });
    } catch (e: any) {
      throw new Error(`deleteGive: ${e.message}`);
    }
  };
  deleteWithdrawal = async (
    txid: string
  ) => {
    try {
      await this.prisma.withdrawal.delete({
        where: { txid }
      });
    } catch (e: any) {
      throw new Error(`deleteWithdrawal: ${e.message}`);
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

  private _execTransaction = async (
    inserts: any[]
  ) => {
    try {
      return await this.prisma.$transaction(inserts);
    } catch (e: any) {
      throw new Error(`_execTransaction: ${e.message}`);
    }
  };

  private _toPlatformTable = (
    platform: string
  ) => {
    switch (platform) {
      case 'telegram':
        return `userTelegram`;
      case 'twitter':
        return 'userTwitter';
      case 'discord':
        return 'userDiscord';
    }
  };
};