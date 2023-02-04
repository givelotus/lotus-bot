import * as Platforms from './platforms'
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

export default class LotusBot {
  private prisma: Database;
  private wallets: WalletManager;
  private platform: string;
  private apiKey: string;
  private bot: Platforms.Platform;

  constructor() {
    this.platform = process.argv[2];
    this.apiKey = config.apiKeys[this.platform];
    this.bot = new Platforms[this.platform]();
    this.prisma = new Database(this.platform);
    this.wallets = new WalletManager();
  };

  init = async () => {
    process.on('SIGINT', this._shutdown);
    try {
      await this._initPrisma();
      await this._initWalletManager();
      await this._initBot();
      await this._initReconcileDeposits();
    } catch (e: any) {
      this._log(MAIN, `init: ${e.message}`);
      this._log(MAIN, 'shutting down');
      await this._shutdown();
    }
    this.wallets.on('AddedToMempool', this._handleUtxoAddedToMempool);
    this.bot.on('Balance', this._handleBalanceCommand);
    this.bot.on('Deposit', this._handleDepositCommand);
    this.bot.on('Give', this._handleGiveCommand);
    this.bot.on('Withdraw', this._handleWithdrawCommand);
    this._log(MAIN, "service initialized successfully");
  };

  private _initBot = async () => {
    try {
      await this.bot.setup(this.apiKey);
      await this.bot.launch();
      this._log(this.platform, `initialized`);
    } catch (e: any) {
      throw new Error(`_initBot: ${e.message}`);
    }
  };

  private _initPrisma = async () => {
    try {
      await this.prisma.connect();
      this._log(DB, 'initialized');
    } catch (e: any) {
      throw new Error(`_initPrisma: ${e.message}`);
    }
  };

  private _initWalletManager = async () => {
    try {
      const keys = await this.prisma.getPlatformWalletKeys();
      await this.wallets.init(
        keys.map(key => {
          const { userId, hdPrivKey } = key;
          return {
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
      const deposits = await this.prisma.getPlatformDeposits();
      const newDeposits = utxos.filter(u => {
        const idx = deposits.findIndex(d => u.txid == d.txid);
        return idx < 0;
      });
      for (const newDeposit of newDeposits) {
        await this._saveDeposit(newDeposit);
      }
    } catch (e: any) {
      throw new Error(`_initReconcileDeposits: ${e.message}`);
    }
  };

  private _log = (
    module: string,
    message: string
  ) => console.log(`${module.toUpperCase()}: ${message}`);

  private _shutdown = async () => {
    console.log();
    this._log(`process`, `shutting down`);
    await this.bot?.stop();
    this.wallets?.closeWsEndpoint();
    await this.prisma?.disconnect();
    process.exit(1);
  };

  private _handleUtxoAddedToMempool = async (
    utxo: AccountUtxo
  ) => {
    const utxoString = JSON.stringify(utxo);
    try {
      this._log(WALLET, `deposit received: ${utxoString}`);
      await this._saveDeposit(utxo);
    } catch (e: any) {
      throw new Error(`_handleUtxoAddedToMempool: ${e.message}`);
    }
  };

  private _handleBalanceCommand = async (
    platformId: string,
    message?: Platforms.Message
  ) => {
    this._log(this.platform, `${platformId}: balance command received`);
    try {
      const userId = !(await this.prisma.isValidUser(platformId))
        ? await this._saveAccount(platformId)
        : await this.prisma.getUserId(platformId);
      const balance = await this.wallets.getUserBalance(userId);
      await this.bot.sendBalanceReply(
        platformId,
        Util.toLocaleXPI(balance),
        message
      );
      this._log(
        this.platform,
        `${platformId}: user notified of balance: ${balance} sats`
      );
    } catch (e: any) {
      throw new Error(`_handleBalanceCommand: ${e.message}`);
    }
  };
  /** Gather user's address and send back to user as reply to their message */
  private _handleDepositCommand = async (
    platformId: string,
    message?: Platforms.Message
  ) => {
    try {
      this._log(this.platform, `${platformId}: deposit command received`);
      const userId = !(await this.prisma.isValidUser(platformId))
        ? await this._saveAccount(platformId)
        : await this.prisma.getUserId(platformId);
      const address = this.wallets.getKey(userId)?.address?.toXAddress();
      await this.bot.sendDepositReply(platformId, address, message);
      this._log(this.platform, `${platformId}: deposit: address sent to user`);
    } catch (e: any) {
      throw new Error(`_platformHandleDeposit: ${e.message}`);
    }
  };

  private _handleGiveCommand = async (
    chatId: string,
    replyToMessageId: number,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string,
    message?: Platforms.Message
  ) => {
    try {
      const sats = Util.toSats(value);
      const msg =
        `${fromId}: give: ${fromUsername} -> ${toUsername}: ${sats} sats: `;
      if (sats < TRANSACTION.MIN_OUTPUT_AMOUNT) {
        this._log(
          this.platform,
          msg + `minimum required: ${TRANSACTION.MIN_OUTPUT_AMOUNT}`
        );
        return;
      }
      // Create account for fromId if not exist
      const fromUserId = !(await this.prisma.isValidUser(fromId))
        ? await this._saveAccount(fromId)
        : await this.prisma.getUserId(fromId);
      const balance = await this.wallets.getUserBalance(fromUserId);
      if (sats > balance) {
        this._log(
          this.platform,
          msg + `insufficient balance: ${balance}`
        );
        return;
      }
      // Create account for toId if not exist
      const toUserId = !(await this.prisma.isValidUser(toId))
        ? await this._saveAccount(toId)
        : await this.prisma.getUserId(toId);
      // Give successful; broadcast tx and save to db
      const tx = await this.wallets.genTx({
        fromUserId,
        toUserId,
        sats
      });
      const timestamp = new Date();
      await this.prisma.saveGive({
        txid: tx.txid,
        platform: this.platform.toLowerCase(),
        timestamp,
        fromId: fromUserId,
        toId: toUserId,
        value: sats.toString()
      });
      try {
        await this.wallets.broadcastTx(fromUserId, tx);
        const sats = tx.outputs[0].satoshis;
        this._log(
          DB,
          `${this.platform}: give saved: ${fromUsername} -> ${toUsername}: ` +
          tx.txid
          );
        // Send Give success reply to chat
        await this.bot.sendGiveReply(
          chatId,
          replyToMessageId,
          fromUsername,
          toUsername,
          tx.txid,
          Util.toLocaleXPI(sats),
          message
        );
        this._log(
          this.platform,
          msg + `${sats} sats: success: notified user in group`
        );
      } catch (e: any) {
        this._log(
          this.platform,
          msg + `broadcast failed: ${e.message}`
        );
        await this.prisma.deleteGive(tx.txid);
        return;
      }
    } catch (e: any) {
      throw new Error(`_platformHandleGive: ${e.message}`);
    }
  };

  private _handleWithdrawCommand = async (
    platformId: string,
    outAmount: number,
    outAddress: string,
    message?: Platforms.Message
  ) => {
    try {
      const msg = `${platformId}: withdraw: ${outAmount} ${outAddress}: `;
      let error: string;
      if (!WalletManager.isValidAddress(outAddress)) {
        error = 'invalid addres';
      } else if (isNaN(outAmount)) {
        error = 'invalid amount';
      }
      if (error) {
        this._log(this.platform, msg + error);
        return await this.bot.sendWithdrawReply(
          platformId,
          { error },
          message
        );
      }
      const sats = Util.toSats(outAmount);
      if (sats < TRANSACTION.MIN_OUTPUT_AMOUNT) {
        this._log(
          this.platform,
          msg + `minimum required: ` +
          `${sats} < ${TRANSACTION.MIN_OUTPUT_AMOUNT}`
        );
        return await this.bot.sendWithdrawReply(
          platformId,
          { error:
            `withdraw minimum is ` +
            `${Util.toLocaleXPI(TRANSACTION.MIN_OUTPUT_AMOUNT)} XPI`
          },
          message
        );
      }
      const userId = !(await this.prisma.isValidUser(platformId))
        ? await this._saveAccount(platformId)
        : await this.prisma.getUserId(platformId);
      // Get the user's XAddress and check against outAddress
      const address = this.wallets.getXAddress(userId);
      if (address == outAddress) {
        this._log(
          this.platform,
          msg + `withdraw to self not allowed`
        );
        return await this.bot.sendWithdrawReply(
          platformId,
          { error: 'you must withdraw to an external wallet' },
          message
        );
      }
      const balance = await this.wallets.getUserBalance(userId);
      if (sats > balance) {
        this._log(
          this.platform,
          msg + `insufficient balance: ${sats} > ${balance}`
        );
        return await this.bot.sendWithdrawReply(
          platformId,
          { error: 'insufficient balance' },
          message
        );
      }
      const tx = await this.wallets.genTx({
        fromUserId: userId,
        outAddress,
        sats
      });
      const timestamp = new Date();
      await this.prisma.saveWithdrawal({
        txid: tx.txid,
        value: sats.toString(),
        timestamp,
        userId
      });
      this._log(DB, msg + `saved: ${tx.txid}`);
      try {
        const txid = await this.wallets.broadcastTx(userId, tx);
        this._log(WALLET, msg + `accepted: ${txid}`);
        const outSats = tx.outputs[0].satoshis;
        await this.bot.sendWithdrawReply(
          platformId,
          { txid, amount: Util.toLocaleXPI(outSats) },
          message
        );
        this._log(
          this.platform,
          msg + `user notified: ${outSats} sats: ${txid}`
        );
      } catch (e: any) {
        this._log(
          this.platform,
          msg + `broadcast failed: ${e.message}`
        );
        await this.prisma.deleteWithdrawal(tx.txid);
        return await this.bot.sendWithdrawReply(
          platformId,
          { error: `error processing withdrawal, contact admin` }
        );
      }
    } catch (e: any) {
      throw new Error(`_handleWithdrawCommand: ${e.message}`);
    }
  };
  
  /**
   * - Save platform account to database
   * - Load new account `WalletKey` into WalletManager
   * - Return `userId` and `key` from saved account
   */
  private _saveAccount = async (
    platformId: string
  ) => {
    try {
      const accountId = Util.newUUID();
      const userId = Util.newUUID();
      const mnemonic = WalletManager.newMnemonic();
      const hdPrivKey = WalletManager.newHDPrivateKey(mnemonic);
      const hdPubKey = hdPrivKey.hdPublicKey;
      await this.prisma.saveAccount({
        accountId,
        userId,
        platform: this.platform,
        platformId,
        mnemonic: mnemonic.toString(),
        hdPrivKey: hdPrivKey.toString(),
        hdPubKey: hdPubKey.toString()
      });
      await this.wallets.loadKey({ userId, hdPrivKey });
      this._log(DB, `new account saved: ${accountId}`);
      return userId;
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
        await this.prisma.isWithdrawTx(utxo.txid)
      ) {
        this._log(DB, `deposit is a Give/Withdraw tx: skipping: ${utxo.txid}`);
        return;
      }
      const timestamp = new Date();
      const data = { ...utxo, timestamp };
      const deposit = await this.prisma.saveDeposit(data);
      const platformId = deposit.user[this.platform.toLowerCase()].id;
      const balance = await this.wallets.getUserBalance(utxo.userId);
      this._log(DB, `deposit saved: ${utxo.txid}`);
      await this.bot.sendDepositReceived(
        platformId,
        utxo.txid,
        Util.toLocaleXPI(utxo.value),
        Util.toLocaleXPI(balance)
      );
      this._log(
        this.platform,
        `${platformId}: user notified of deposit received: ${utxo.txid}`
      );
    } catch (e: any) {
      throw new Error(`_saveDeposit: ${e.message}`);
    }
  };

};