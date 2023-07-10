import { PlatformName } from './platforms';
import * as Util from '../util';
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
  private wallet: WalletManager;

  constructor(
    prisma: Database,
    wallet: WalletManager
  ) {
    super();
    this.prisma = prisma;
    this.wallet = wallet;
    // Set up event handlers once we are ready
    this.wallet.on('AddedToMempool', this.walletUtxoAddedToMempool);
  };
  /** Informational and error logging */
  log = (
    module: string,
    message: string
  ) => console.log(`${module.toUpperCase()}: ${message}`);
  /* Called by any bot module that runs into unrecoverable error */
  shutdown = () => this.emit('Shutdown');
  /** Make sure we process deposits we received while offline */
  init = async () => {
    this.log(MAIN, `reconciling deposits with UTXO set`);
    try {
      const utxos = this.wallet.getUtxos();
      const deposits = await this.prisma.getDeposits();
      const newDeposits = utxos.filter(u => {
        return deposits.findIndex(d => u.txid == d.txid) < 0;
      });
      for (const deposit of newDeposits) {
        await this._saveDeposit(deposit);
      }
    } catch (e: any) {
      throw new Error(`_initReconcileDeposits: ${e.message}`);
    }
  };
  /**  */
  walletUtxoAddedToMempool = async (
    utxo: AccountUtxo
  ) => {
    try {
      await this._saveDeposit(utxo);
    } catch (e: any) {
      this.log(MAIN, `walletsUtxoAddedToMempool: FATAL: ${e.message}`);
      this.shutdown();
    }
  };

  processBalanceCommand = async (
    platform: PlatformName,
    platformId: string,
  ): Promise<string> => {
    const msg = `${platformId}: balance`;
    this.log(platform, `${msg}: command received`);
    try {
      const { accountId } = await this._getIds(platform, platformId);
      const balance = await this.wallet.getAccountBalance(accountId);
      return Util.toXPI(balance);
    } catch (e: any) {
      throw new Error(`${msg}: ERROR: ${e.message}`);
    }
  };
  
  processDepositCommand = async (
    platform: PlatformName,
    platformId: string,
  ) => {
    const msg = `${platformId}: deposit`;
    this.log(platform, `${msg}: command received`);
    try {
      const { userId } = await this._getIds(platform, platformId);
      return this.wallet.getXAddress(userId);
    } catch (e: any) {
      throw new Error(`${msg}: ERROR: ${e.message}`);
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
    const sats = Util.toSats(value);
    const msg =
      `${fromId}: give: ${fromUsername} -> ${toId} (${toUsername}): ${sats} sats`;
    this.log(platform, `${msg}: command received`);
    try {
      if (sats < MIN_OUTPUT_AMOUNT) {
        throw new Error(`${msg}: ERROR: minimum required: ${MIN_OUTPUT_AMOUNT}`);
      }
      // Create account for fromId if not exist
      const {
        accountId: fromAccountId,
        userId: fromUserId
      } = await this._getIds(platform, fromId);
      const balance = await this.wallet.getAccountBalance(fromAccountId);
      if (sats > balance) {
        throw new Error(`${msg}: ERROR: insufficient balance: ${balance}`);
      }
      // Create account for toId if not exist
      const {
        userId: toUserId
      } = await this._getIds(platform, toId);
      // Give successful; broadcast tx and save to db
      const tx = await this.wallet.genTx({
        fromAccountId,
        toUserId,
        sats
      });
      // save give to database before broadcasting
      try {
        await this.prisma.saveGive({
          txid: tx.txid,
          platform: platform.toLowerCase(),
          timestamp: new Date(),
          fromId: fromUserId,
          toId: toUserId,
          value: sats.toString()
        });
      } catch (e: any) {
        throw new Error(`${msg}: failed to save give: ${e.message}`);
      }
      this.log(DB, `${msg}: saved to db: ${tx.txid}`);
      // try to broadcast the give tx
      try {
        await this.wallet.broadcastTx(tx);
      } catch (e: any) {
        await this.prisma.deleteGive(tx.txid);
        throw new Error(`${msg}: ERROR: broadcast failed: ${e.message}`);
      }
      // return broadcasted tx data
      return {
        txid: tx.txid,
        amount: Util.toXPI(tx.outputs[0].satoshis) 
      };
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  processWithdrawCommand = async (
    platform: PlatformName,
    platformId: string,
    outAmount: string,
    outAddress: string,
  ): Promise<{
    txid: string,
    amount: string
  } | string> => {
    const msg = `${platformId}: withdraw: ${outAmount} -> ${outAddress}`;
    this.log(platform, `${msg}: command received`);
    try {
      const sats = Util.toSats(outAmount);
      if (!WalletManager.isValidAddress(outAddress)) {
        return `invalid address: \`${outAddress}\``;
      } else if (sats < MIN_OUTPUT_AMOUNT) {
        return `withdraw minimum is ${Util.toXPI(MIN_OUTPUT_AMOUNT)} XPI`;
      }
      const {
        accountId,
        userId
      } = await this._getIds(platform, platformId);
      // Get the user's XAddress and check against outAddress
      const addresses = this.wallet.getXAddresses(accountId);
      if (addresses.includes(outAddress)) {
        return `you must withdraw to an external wallet`;
      }
      // Get the user's balance and check against outAmount
      const balance = await this.wallet.getAccountBalance(accountId);
      if (sats > balance) {
        return `insufficient balance: ${sats} > ${balance}`;
      }
      // Generate withdrawal tx
      const tx = await this.wallet.genTx({
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
        throw new Error(`failed to save withdrawal: ${e.message}`);
      }
      this.log(DB, `${msg}: saved: ${tx.txid}`);
      // try to broadcast the withdrawal tx
      try {
        // Broadcast the withdrawal to network
        const txid = await this.wallet.broadcastTx(tx);
        this.log(WALLET, `${msg}: accepted by network: ${txid}`);
        // Get the actual number of sats in the tx output to reply to user
        const outSats = tx.outputs[0].satoshis;
        return {
          txid: tx.txid,
          amount: Util.toXPI(outSats)
        };
      } catch (e: any) {
        // If tx broadcast fails, delete the withdrawal database entry
        await this.prisma.deleteWithdrawal(tx.txid);
        throw new Error(`withdrawal broadcast failed: ${e.message}`);
      }
    } catch (e: any) {
      throw new Error(`${msg}: ${e.message}`);
    }
  };

  processLinkCommand = async (
    platform: PlatformName,
    platformId: string,
    secret: string | undefined,
  ): Promise<{
    secret: string
  } | string> => {
    const msg = `${platformId}: link: ${secret ? '<redacted>' : 'initiate'}`;
    this.log(platform, `${msg}: command received`);
    try {
      const { accountId, userId } = await this._getIds(platform, platformId);
      switch (typeof secret) {
        /** User provided secret to link account */
        case 'string':
          // Get the accountId associated with the user with the secret
          const linkAccountId = await this.prisma.getAccountIdFromSecret(secret);
          // sanity checks
          if (!linkAccountId) {
            return 'invalid secret provided';
          } else if (linkAccountId == accountId) {
            return 'own secret provided or already linked';
          }
          // try to update the user's accountId
          await this.prisma.updateUserAccountId(userId, linkAccountId);
          this.log(
            platform,
            `${msg}: successfully linked to ${linkAccountId} accountId`
          );
          // update walletkey with new accountId
          this.wallet.updateKey(userId, accountId, linkAccountId);
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
      throw new Error(`${msg}: ${e.message}`);
    }
  };

  processBackupCommand = async (
    platform: PlatformName,
    platformId: string,
  ) => {
    const msg = `${platformId}: backup`;
    this.log(platform, `${msg}: command received`);
    try {
      const { userId } = await this._getIds(platform, platformId);
      const mnemonic = await this.prisma.getUserMnemonic(userId);
      return mnemonic;
    } catch (e: any) {
      this.log(platform, `${msg}: ERROR: ${e.message}`);
      throw new Error(`${msg}: ${e.message}`);
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
      await this.wallet.loadKey({ accountId, userId, hdPrivKey });
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
        const { accountId } = deposit.user;
        const balance = await this.wallet.getAccountBalance(accountId);
        return this.emit('DepositSaved', {
          platform: platformName as PlatformName,
          platformId: user.id,
          txid: utxo.txid,
          amount: Util.toXPI(utxo.value),
          balance: Util.toXPI(balance)
        });
      }
    } catch (e: any) {
      throw new Error(`_saveDeposit: ${e.message}`);
    }
  };

};