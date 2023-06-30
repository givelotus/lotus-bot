import {
  Platforms,
  PlatformName,
  PlatformMessage,
  Platform,
} from './platforms';
import * as Util from '../util';
import config from '../config';
import { TRANSACTION } from '../util/constants';
import {
  AccountUtxo,
  WalletManager,
} from './wallet';
import {
  Database,
} from './database';
import { EventEmitter } from 'events';

// Constants used for logging purposes
const WALLET = 'walletmanager';
const DB = 'prisma';
const MAIN = 'handler';

const { MIN_OUTPUT_AMOUNT } = TRANSACTION;
/**
 * Master class  
 * Processes all platform commands  
 * Handles communication between submodules
 */
export class Handler extends EventEmitter {
  private prisma: Database;
  private wallets: WalletManager;

  constructor(
    prisma: Database,
    wallets: WalletManager
  ) {
    super();
    this.prisma = prisma;
    this.wallets = wallets;
  };
  /** Informational and error logging */
  log = (
    module: string,
    message: string
  ) => console.log(`${module.toUpperCase()}: ${message}`);
  /** Platform notification error logging */
  logPlatformNotifyError = (
    platform: PlatformName,
    msg: string,
    error: string
  ) => this.log(platform, `${msg} failed to notify user: ${error}`);
  /* Called by any bot module that runs into unrecoverable error */
  shutdown = () => this.emit('shutdown');

  walletsUtxoAddedToMempool = async (
    utxo: AccountUtxo
  ) => {
    try {
      await this._saveDeposit(utxo);
    } catch (e: any) {
      this.log(MAIN, `FATAL: walletsUtxoAddedToMempool: ${e.message}`);
      this.emit('shutdown');
    }
  };

  processBalanceCommand = async (
    platform: PlatformName,
    platformId: string,
  ): Promise<number> => {
    this.log(platform, `${platformId}: balance command received`);
    const msg = `${platformId}: balance: `;
    try {
      const { accountId } = await this._getIds(platform, platformId);
      const balance = await this.wallets.getAccountBalance(accountId);
      return balance;
    } catch (e: any) {
      this.log(MAIN, `FATAL: plaformBalanceCommand: ${e.message}`);
      this.emit('shutdown');
    }
  };
  
  processDepositCommand = async (
    platform: PlatformName,
    platformId: string,
  ) => {
    this.log(platform, `${platformId}: deposit command received`);
    const msg = `${platformId}: deposit: `;
    try {
      const { userId } = await this._getIds(platform, platformId);
      const address = this.wallets.getXAddress(userId);
      return address;
    } catch (e: any) {
      this.log(MAIN, `FATAL: platformDepositCommand: ${e.message}`);
      this.emit('shutdown');
    }
  };

  processGiveCommand = async (
    platform: PlatformName,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string,
  ) => {
    this.log(
      platform,
      `${fromId}: give command received: ${fromUsername} -> ${toUsername}`
    );
    const sats = Util.toSats(value);
    const msg =
      `${fromId}: give: ${fromUsername} -> ${toId} (${toUsername}): ${sats} sats: `;
    try {
      if (sats < MIN_OUTPUT_AMOUNT) {
        this.log(
          platform,
          msg + `minimum required: ${MIN_OUTPUT_AMOUNT}`
        );
        return;
      }
      // Create account for fromId if not exist
      const {
        accountId: fromAccountId,
        userId: fromUserId
      } = await this._getIds(platform, fromId);
      const balance = await this.wallets.getAccountBalance(fromAccountId);
      if (sats > balance) {
        this.log(platform, msg + `insufficient balance: ${balance}`);
        return;
      }
      // Create account for toId if not exist
      const {
        userId: toUserId
      } = await this._getIds(platform, toId);
      // Give successful; broadcast tx and save to db
      const tx = await this.wallets.genTx({
        fromAccountId,
        toUserId,
        sats
      });
      // save give to database before broadcasting
      await this.prisma.saveGive({
        txid: tx.txid,
        platform: platform.toLowerCase(),
        timestamp: new Date(),
        fromId: fromUserId,
        toId: toUserId,
        value: sats.toString()
      });
      this.log(DB, msg + `saved to db: ` + tx.txid);
      // try to broadcast the give tx
      try {
        await this.wallets.broadcastTx(tx);
      } catch (e: any) {
        this.log(platform, msg + `broadcast failed: ${e.message}`);
        await this.prisma.deleteGive(tx.txid);
        return;
      }
      // return broadcasted tx data
      return {
        txid: tx.txid,
        amount: Util.toXPI(tx.outputs[0].satoshis) 
      };
      /*
      try {
        // Send Give success reply to chat
        await bot.sendGiveReply(
          chatId,
          replyToMessageId,
          fromUsername,
          toUsername,
          tx.txid,
          Util.toXPI(sats),
          message
        );
        this.log(platform, msg + `success: user notified`);
      } catch (e: any) {
        this.logPlatformNotifyError(platform, msg, e.message);
      }
      */
    } catch (e: any) {
      this.log(MAIN, `FATAL: platformGiveCommand: ${e.message}`);
      this.emit('shutdown');
    }
  };

  processWithdrawCommand = async (
    platform: PlatformName,
    platformId: string,
    outAmount: number,
    outAddress: string,
  ): Promise<{
    txid?: string,
    amount?: string,
    error?: string,
  }> => {
    this.log(
      platform,
      `${platformId}: withdraw command received: ${outAmount} ${outAddress}`
    );
    const msg = `${platformId}: withdraw: ${outAmount} ${outAddress}: `;
    try {
      const sats = Util.toSats(outAmount);
      let error: string = '';
      if (!WalletManager.isValidAddress(outAddress)) {
        error = 'invalid address';
      } else if (isNaN(outAmount)) {
        error = 'invalid amount';
      } else if (sats < MIN_OUTPUT_AMOUNT) {
        error = `withdraw minimum is ${Util.toXPI(MIN_OUTPUT_AMOUNT)} XPI`;
      }
      if (error) {
        throw new Error(error);
      }
      const {
        accountId,
        userId
      } = await this._getIds(platform, platformId);
      // Get the user's XAddress and check against outAddress
      const addresses = this.wallets.getXAddresses(accountId);
      if (addresses.includes(outAddress)) {
        throw new Error('you must withdraw to an external wallet');
      }
      // Get the user's balance and check against outAmount
      const balance = await this.wallets.getAccountBalance(accountId);
      if (sats > balance) {
        this.log(
          platform,
          msg + `insufficient balance: ${sats} > ${balance}`
        );
        throw new Error('insufficient balance');
      }
      // Generate transaction and get num of utxos used in the tx
      const tx = await this.wallets.genTx({
        fromAccountId: accountId,
        outAddress,
        sats
      });
      // Save the withdrawal to the database before broadcasting
      try {
        await this.prisma.saveWithdrawal({
          txid: tx.txid,
          value: sats.toString(),
          timestamp: new Date(),
          userId
        });
      } catch (e: any) {
        throw new Error('failed to save withdrawal');
      }
      this.log(DB, msg + `saved: ${tx.txid}`);
      // try to broadcast the withdrawal tx
      try {
        // Broadcast the withdrawal to network
        const txid = await this.wallets.broadcastTx(tx);
        this.log(WALLET, msg + `accepted: ${txid}`);
        // Get the actual number of sats in the tx output to reply to user
        const outSats = tx.outputs[0].satoshis;
        return {
          txid: tx.txid,
          amount: Util.toXPI(outSats)
        };
      } catch (e: any) {
        // If tx broadcast fails, delete the withdrawal database entry
        await this.prisma.deleteWithdrawal(tx.txid);
        throw new Error('withdrawal broadcast failed');
      }
    } catch (e: any) {
      // Return the error to the platform for notifying the user
      this.log(platform, `${msg}: ERROR: ${e.message}`);
      return { error: e.message };
    }
  };

  processLinkCommand = async (
    platform: PlatformName,
    platformId: string,
    secret: string | undefined,
  ) => {
    this.log(platform, `${platformId}: link command received`);
    const msg = `${platformId}: link: ${secret ? '<redacted>' : 'initiate'}: `;
    let error: string;
    try {
      const { accountId, userId } = await this._getIds(platform, platformId);
      switch (typeof secret) {
        /** User provided secret to link account */
        case 'string':
          // Get the accountId associated with the user with the secret
          const linkAccountId = await this.prisma.getAccountIdFromSecret(secret);
          // sanity checks
          if (!linkAccountId) {
            error = 'invalid secret provided';
          } else if (linkAccountId == accountId) {
            error = 'own secret provided or already linked';
          }
          if (error) {
            throw new Error(error);
          }
          // try to update the user's accountId
          await this.prisma.updateUserAccountId(userId, linkAccountId);
          this.log(
            platform,
            msg + `successfully linked to ${linkAccountId} accountId`
          );
          // update walletkey with new accountId
          this.wallets.updateKey(userId, accountId, linkAccountId);
          return { secret: undefined };
        /** User wants secret to link account */
        case 'undefined':
          const userSecret = await this.prisma.getUserSecret(
            platform,
            platformId
          );
          // try to send secret to the platform user
          return { secret: userSecret };
      }
    } catch (e: any) {
      this.log(platform, `${msg}: ERROR: ${e.message}`);
      return { error: e.message };
    }
  };

  processBackupCommand = async (
    platform: PlatformName,
    platformId: string,
  ) => {
    const msg = `${platformId}: backup: `;
    this.log(platform, msg + `command received`);
    try {
      const { userId } = await this._getIds(platform, platformId);
      const mnemonic = await this.prisma.getUserMnemonic(userId);
      return mnemonic;
    } catch (e: any) {
      this.log(platform, `${msg}: ERROR: ${e.message}`);
      return { error: e.message };
    }
  };
  
  /**
   * Checks if `platformId` of `platform` is valid.  
   * If not, creates it; if so, gathers data from the database  
   * @returns `accountId` and `userId`
   */
  private _getIds = async (
    platform: PlatformName,
    platformId: string,
  ) => {
    try {
      const isValidUser = await this.prisma.isValidUser(platform, platformId);
      return !isValidUser
        ? await this._saveAccount(platform, platformId)
        : await this.prisma.getIds(platform, platformId);
    } catch (e: any) {
      throw new Error(`_getIds: ${e.message}`);
    }
  };
  /**
   * - Save platformId/user/account to database
   * - Load new account `WalletKey` into WalletManager
   * - Return `accountId` and `userId` from saved account
   */
  private _saveAccount = async (
    platform: PlatformName,
    platformId: string
  ) => {
    try {
      const accountId = Util.newUUID();
      const userId = Util.newUUID();
      const secret = Util.newUUID();
      const mnemonic = WalletManager.newMnemonic();
      const hdPrivKey = WalletManager.newHDPrivateKey(mnemonic);
      const hdPubKey = hdPrivKey.hdPublicKey;
      await this.prisma.saveAccount({
        accountId,
        userId,
        secret,
        platform,
        platformId,
        mnemonic: mnemonic.toString(),
        hdPrivKey: hdPrivKey.toString(),
        hdPubKey: hdPubKey.toString()
      });
      await this.wallets.loadKey({ accountId, userId, hdPrivKey });
      this.log(DB, `new account saved: ${accountId}`);
      return { accountId, userId };
    } catch (e: any) {
      throw new Error(`_saveAccount: ${e.message}`);
    }
  };

  private _saveDeposit = async (
    utxo: AccountUtxo
  ) => {
    try {
      if (
        await this.prisma.isGiveTx(utxo.txid) ||
        // Accept a withdrawl as a deposit if the outIdx is not the change Idx
        // Fixes https://github.com/givelotus/lotus-bot/issues/48
        (
          await this.prisma.isWithdrawTx(utxo.txid) &&
          utxo.outIdx == WalletManager.WITHDRAW_CHANGE_OUTIDX
        )
      ) {
        return;
      }
      const deposit = await this.prisma.saveDeposit({
        ...utxo,
        timestamp: new Date()
      });
      this.log(DB, `deposit saved: ${JSON.stringify(utxo)}`);
      for (const [ platformName, user ] of Object.entries(deposit.user)) {
        if (typeof user == 'string' || !user) {
          continue;
        }
        const platform = platformName as PlatformName;
        const platformId = user.id;
        const { accountId } = deposit.user;
        const balance = await this.wallets.getAccountBalance(accountId);
        return {
          txid: utxo.txid,
          amount: Util.toXPI(utxo.value),
          balance: Util.toXPI(balance)
        };
      }
    } catch (e: any) {
      throw new Error(`_saveDeposit: ${e.message}`);
    }
  };

};