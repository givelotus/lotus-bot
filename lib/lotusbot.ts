import {
  Platforms,
  PlatformName,
  PlatformMessage,
  Platform,
} from './platforms'
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

// Constants used for logging purposes
const WALLET = 'walletmanager';
const DB = 'prisma';
const MAIN = 'lotusbot';

const { MIN_OUTPUT_AMOUNT } = TRANSACTION;
/**
 * Master class  
 * Processes all platform commands  
 * Handles communication between submodules
 */
export default class LotusBot {
  private prisma: Database;
  private wallets: WalletManager;
  private bots: { [platform in PlatformName]?: Platform } = {};
  /** Hold enabled platforms */
  private platforms: [name: PlatformName, apiKey: string][] = [];

  constructor() {
    this.prisma = new Database();
    this.wallets = new WalletManager();
    /** Gather enabled platforms */
    for (const [ platform, apiKey ] of Object.entries(config.apiKeys)) {
      const name = platform as PlatformName;
      if (apiKey) {
        this.platforms.push([name, apiKey]);
        this.bots[name] = new Platforms[name]();
      }
    }
  };
  /**
   * Initialize all submodules  
   * Set up required event handlers
   */
  init = async () => {
    process.on('SIGINT', this._shutdown);
    try {
      await this._initPrisma();
      await this._initWalletManager();
      await this._initBots();
      await this._initReconcileDeposits();
    } catch (e: any) {
      this._log(MAIN, `FATAL: init: ${e.message}`);
      await this._shutdown();
    }
    // Set up event handlers once we are ready
    this.wallets.on('AddedToMempool', this._handleUtxoAddedToMempool);
    this.platforms.forEach(([ name ]) => {
      this.bots[name].on('Balance', this._handleBalanceCommand);
      this.bots[name].on('Deposit', this._handleDepositCommand);
      this.bots[name].on('Give', this._handleGiveCommand);
      this.bots[name].on('Withdraw', this._handleWithdrawCommand);
      this.bots[name].on('Link', this._handleLinkCommand);
      this.bots[name].on('Backup', this._handleBackupCommand);
    });
    this._log(MAIN, "service initialized successfully");
  };
  /**
   * Initialize all configured bot modules  
   * A bot module is considered enabled if the `.env` includes `APIKEY` entry
   */
  private _initBots = async () => {
    for (const [ name, apiKey ] of this.platforms) {
      try {
        await this.bots[name].setup(apiKey);
        await this.bots[name].launch();
        this._log(name, `initialized`);
      } catch (e: any) {
        throw new Error(`_initBot: ${e.message}`);
      }
    }
  };
  /**
   * Initialize Prisma module:  
   * - Connect to the database
   */
  private _initPrisma = async () => {
    try {
      await this.prisma.connect();
      this._log(DB, 'initialized');
    } catch (e: any) {
      throw new Error(`_initPrisma: ${e.message}`);
    }
  };
  /**
   * Initialize WalletManager module:  
   * - Get all WalletKeys from database
   * - Load all WalletKeys into WalletManager
   */
  private _initWalletManager = async () => {
    try {
      const keys = await this.prisma.getUserWalletKeys();
      await this.wallets.init(
        keys.map(key => {
          const { accountId, userId, hdPrivKey } = key;
          return {
            accountId,
            userId,
            hdPrivKey: WalletManager.hdPrivKeyFromBuffer(hdPrivKey)
          }
        })
      );
      this._log(WALLET, 'initialized');
    } catch (e: any) {
      throw new Error(`_initWalletManager: ${e.message}`);
    }
  };
  /** Make sure we process deposits we received while offline */
  private _initReconcileDeposits = async () => {
    this._log(MAIN, `reconciling deposits with UTXO set`);
    try {
      const utxos = this.wallets.getUtxos();
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
  /** Informational and error logging */
  private _log = (
    module: string,
    message: string
  ) => console.log(`${module.toUpperCase()}: ${message}`);
  /** Platform notification error logging */
  private _logPlatformNotifyError = (
    platform: PlatformName,
    msg: string,
    error: string
  ) => this._log(platform, `${msg} failed to notify user: ${error}`);
  /** Shutdown all submodules */
  private _shutdown = async () => {
    console.log();
    this._log(MAIN, 'shutting down');
    /** Shutdown enabled platforms */
    for (const [ name ] of this.platforms) {
      await this.bots[name].stop();
    }
    this.wallets?.closeWsEndpoint();
    await this.prisma?.disconnect();
    process.exit(1);
  };

  private _handleUtxoAddedToMempool = async (
    utxo: AccountUtxo
  ) => {
    try {
      await this._saveDeposit(utxo);
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleUtxoAddedToMempool: ${e.message}`);
      await this._shutdown();
    }
  };

  private _handleBalanceCommand = async (
    platform: PlatformName,
    platformId: string,
    message?: PlatformMessage
  ) => {
    this._log(platform, `${platformId}: balance command received`);
    const msg = `${platformId}: balance: `;
    try {
      const { accountId } = await this._checkAccountValid(platform, platformId);
      const balance = await this.wallets.getAccountBalance(accountId);
      // try to notify user of balance
      try {
        await this.bots[platform].sendBalanceReply(
          platformId,
          Util.toXPI(balance),
          message
        );
        this._log(platform, msg + `${balance} sats: user notified`);
      } catch (e: any) {
        this._logPlatformNotifyError(platform, msg, e.message);
      }
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleBalanceCommand: ${e.message}`);
      await this._shutdown();
    }
  };
  /** Gather user's address and send back to user as reply to their message */
  private _handleDepositCommand = async (
    platform: PlatformName,
    platformId: string,
    message?: PlatformMessage
  ) => {
    this._log(platform, `${platformId}: deposit command received`);
    const msg = `${platformId}: deposit: `;
    try {
      const { userId } = await this._checkAccountValid(platform, platformId);
      const address = this.wallets.getXAddress(userId);
      // try to notify user of deposit address
      try {
        await this.bots[platform].sendDepositReply(platformId, address, message);
        this._log(platform, msg + `${address}: user notified`);
      } catch (e: any) {
        this._logPlatformNotifyError(platform, msg, e.message);
      }
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleDepositCommand: ${e.message}`);
      await this._shutdown();
    }
  };

  private _handleGiveCommand = async (
    platform: PlatformName,
    chatId: string,
    replyToMessageId: number,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string,
    message?: PlatformMessage
  ) => {
    const bot = this.bots[platform];
    try {
      this._log(
        platform,
        `${fromId}: give command received: ${fromUsername} -> ${toUsername}`
      );
      const sats = Util.toSats(value);
      const msg =
        `${fromId}: give: ${fromUsername} -> ${toId} (${toUsername}): ${sats} sats: `;
      if (sats < MIN_OUTPUT_AMOUNT) {
        this._log(
          platform,
          msg + `minimum required: ${MIN_OUTPUT_AMOUNT}`
        );
        return;
      }
      // Create account for fromId if not exist
      const {
        accountId: fromAccountId,
        userId: fromUserId
      } = await this._checkAccountValid(platform, fromId);
      const balance = await this.wallets.getAccountBalance(fromAccountId);
      if (sats > balance) {
        this._log(platform, msg + `insufficient balance: ${balance}`);
        return;
      }
      // Create account for toId if not exist
      const {
        userId: toUserId
      } = await this._checkAccountValid(platform, toId);
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
      this._log(DB, msg + `saved to db: ` + tx.txid);
      // try to broadcast the give tx
      try {
        await this.wallets.broadcastTx(tx);
      } catch (e: any) {
        this._log(platform, msg + `broadcast failed: ${e.message}`);
        await this.prisma.deleteGive(tx.txid);
        return;
      }
      // try to notify users of successful give
      try {
        const sats = tx.outputs[0].satoshis;
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
        this._log(platform, msg + `success: user notified`);
      } catch (e: any) {
        this._logPlatformNotifyError(platform, msg, e.message);
      }
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleGiveCommand: ${e.message}`);
      await this._shutdown();
    }
  };

  private _handleWithdrawCommand = async (
    platform: PlatformName,
    platformId: string,
    outAmount: number,
    outAddress: string,
    message?: PlatformMessage
  ) => {
    const bot = this.bots[platform];
    try {
      this._log(
        platform,
        `${platformId}: withdraw command received: ${outAmount} ${outAddress}`
      );
      const msg = `${platformId}: withdraw: ${outAmount} ${outAddress}: `;
      let error: string;
      if (!WalletManager.isValidAddress(outAddress)) {
        error = 'invalid address';
      } else if (isNaN(outAmount)) {
        error = 'invalid amount';
      }
      if (error) {
        this._log(platform, msg + error);
        return await bot.sendWithdrawReply(
          platformId,
          { error },
          message
        );
      }
      const sats = Util.toSats(outAmount);
      if (sats < MIN_OUTPUT_AMOUNT) {
        this._log(
          platform,
          msg + `minimum required: ` +
          `${sats} < ${MIN_OUTPUT_AMOUNT}`
        );
        return await bot.sendWithdrawReply(
          platformId,
          { error:
            `withdraw minimum is ` +
            `${Util.toXPI(MIN_OUTPUT_AMOUNT)} XPI`
          },
          message
        );
      }
      const {
        accountId,
        userId
      } = await this._checkAccountValid(platform, platformId);
      // Get the user's XAddress and check against outAddress
      const addresses = this.wallets.getXAddresses(accountId);
      if (addresses.includes(outAddress)) {
        this._log(
          platform,
          msg + `withdraw to self not allowed`
        );
        return await bot.sendWithdrawReply(
          platformId,
          { error: 'you must withdraw to an external wallet' },
          message
        );
      }
      // Get the user's balance and check against outAmount
      const balance = await this.wallets.getAccountBalance(accountId);
      if (sats > balance) {
        this._log(
          platform,
          msg + `insufficient balance: ${sats} > ${balance}`
        );
        return await bot.sendWithdrawReply(
          platformId,
          { error: 'insufficient balance' },
          message
        );
      }
      // Generate transaction and get num of utxos used in the tx
      const tx = await this.wallets.genTx({
        fromAccountId: accountId,
        outAddress,
        sats
      });
      // Save the withdrawal to the database before broadcasting
      await this.prisma.saveWithdrawal({
        txid: tx.txid,
        value: sats.toString(),
        timestamp: new Date(),
        userId
      });
      this._log(DB, msg + `saved: ${tx.txid}`);
      // try to broadcast the withdrawal tx
      try {
        // Broadcast the withdrawal to network
        const txid = await this.wallets.broadcastTx(tx);
        this._log(WALLET, msg + `accepted: ${txid}`);
      } catch (e: any) {
        this._log(
          platform,
          msg + `broadcast failed: ${e.message}`
        );
        await this.prisma.deleteWithdrawal(tx.txid);
        return await bot.sendWithdrawReply(
          platformId,
          { error: `error processing withdrawal, contact admin` }
        );
      }
      // try to notify user of successful withdrawal
      try {
        // Get the actual number of sats in the tx output to reply to user
        const outSats = tx.outputs[0].satoshis;
        await bot.sendWithdrawReply(
          platformId,
          { txid: tx.txid, amount: Util.toXPI(outSats) },
          message
        );
        this._log(
          platform,
          msg + `success: user notified`
        );
      } catch (e: any) {
        this._logPlatformNotifyError(platform, msg, e.message);
      }
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleWithdrawCommand: ${e.message}`);
      await this._shutdown();
    }
  };

  private _handleLinkCommand = async (
    platform: PlatformName,
    platformId: string,
    secret: string | undefined,
    message?: PlatformMessage
  ) => {
    this._log(platform, `${platformId}: link command received`);
    const msg = `${platformId}: link: ${secret ? '<redacted>' : 'initiate'}: `;
    let error: string;
    try {
      const {
        accountId,
        userId
      } = await this._checkAccountValid(platform, platformId);
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
            this._log(platform, msg + error);
            try {
              return await this.bots[platform].sendLinkReply(
                platformId,
                { error },
                message
              );
            } catch (e: any) {
              return this._logPlatformNotifyError(platform, msg, e.message);
            }
          }
          // try to update the user's accountId
          await this.prisma.updateUserAccountId(userId, linkAccountId);
          this._log(
            platform,
            msg + `successfully linked to ${linkAccountId} accountId`
          );
          // update walletkey with new accountId
          this.wallets.updateKey(userId, accountId, linkAccountId);
          try {
            return await this.bots[platform].sendLinkReply(
              platformId,
              { secret: undefined },
              message
            );
          } catch (e: any) {
            return this._logPlatformNotifyError(platform, msg, e.message);
          }
        /** User wants secret to link account */
        case 'undefined':
          const userSecret = await this.prisma.getUserSecret(
            platform,
            platformId
          );
          // try to send secret to the platform user
          try {
            return await this.bots[platform].sendLinkReply(
              platformId,
              { secret: userSecret },
              message
            );
          } catch (e: any) {
            return this._logPlatformNotifyError(platform, msg, e.message);
          }
      }
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleLinkCommand: ${e.message}`);
      await this._shutdown();
    }
  };

  private _handleBackupCommand = async (
    platform: PlatformName,
    platformId: string,
    message?: PlatformMessage
  ) => {
    const msg = `${platformId}: backup: `;
    this._log(platform, `${platformId}: backup command received`);
    try {
      await this._checkAccountValid(platform, platformId);
      const mnemonic = await this.prisma.getUserMnemonic(platform, platformId);
      try {
        await this.bots[platform].sendBackupReply(platformId, mnemonic, message);
        this._log(platform, msg + `user notified`);
      } catch (e: any) {
        return this._logPlatformNotifyError(platform, msg, e.message)
      }
    } catch (e: any) {
      this._log(MAIN, `FATAL: _handleBackupCommand: ${e.message}`);
      await this._shutdown();
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
      this._log(DB, `new account saved: ${accountId}`);
      return { accountId, userId };
    } catch (e: any) {
      throw new Error(`_saveAccount: ${e.message}`);
    }
  };
  /**
   * Checks if `platformId` of `platform` is valid.  
   * If not, creates it; if so, gathers data from the database  
   * @returns `accountId` and `userId`
   */
  private _checkAccountValid = async (
    platform: PlatformName,
    platformId: string,
  ) => {
    try {
      const isValidUser = await this.prisma.isValidUser(platform, platformId);
      return !isValidUser
        ? await this._saveAccount(platform, platformId)
        : await this.prisma.getIds(platform, platformId);
    } catch (e: any) {
      throw new Error(`_checkAccountValid: ${e.message}`);
    }
  };

  private _saveDeposit = async (
    utxo: AccountUtxo
  ) => {
    try {
      if (
        await this.prisma.isGiveTx(utxo.txid) ||
        await this.prisma.isWithdrawTx(utxo.txid)
      ) {
        return;
      }
      const deposit = await this.prisma.saveDeposit({
        ...utxo,
        timestamp: new Date()
      });
      this._log(DB, `deposit saved: ${JSON.stringify(utxo)}`);
      for (const [ platformName, user ] of Object.entries(deposit.user)) {
        if (typeof user == 'string' || !user) {
          continue;
        }
        const platform = platformName as PlatformName;
        const platformId = user.id;
        const { accountId } = deposit.user;
        const balance = await this.wallets.getAccountBalance(accountId);
        // try to notify user of deposit received
        try {
          await this.bots[platform].sendDepositReceived(
            platformId,
            utxo.txid,
            Util.toXPI(utxo.value),
            Util.toXPI(balance)
          );
          this._log(
            platform,
            `${platformId}: user notified of deposit received: ${utxo.txid}`
          );
        } catch (e: any) {
          this._logPlatformNotifyError(platform, '_saveDeposit:', e.message);
        }
        break;
      }
    } catch (e: any) {
      throw new Error(`_saveDeposit: ${e.message}`);
    }
  };

};