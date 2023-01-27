import * as Platforms from './platforms'
import * as Util from '../util';
import config from '../config';
import {
  AccountUtxo,
  WalletManager,
} from './wallet';
import {
  Database,
} from './database';
import { BOT } from '../util/constants';

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
      await this._initConfirmDeposits();
    } catch (e: any) {
      this._log(MAIN, `init: ${e.message}`);
      this._log(MAIN, 'shutting down');
      this._shutdown();
    }

    this.wallets.on('AddedToMempool', this._handleUtxoAddedToMempool);
    this.wallets.on('Confirmed', this._handleUtxoConfirmed);
    this.bot.on('Balance', this._handleBalanceCommand);
    this.bot.on('Deposit', this._handleDepositCommand);
    this.bot.on('Give', this._handleGiveCommand);
    this.bot.on('Withdraw', this._handleWithdrawCommand);

    const utxoBalance = this.wallets.getUtxoBalance();
    const botAddress = this.wallets.getBotAddress().toXAddress();
    const initMsg =
      `***\r\n` +
      `* Lotus Bot has initialized successfully!\r\n` +
      `* Total UTXO balance: ${utxoBalance} sats\r\n` +
      `***\r\n` +
      `* *NOTE*: Make sure you deposit at least 100 XPI to this address to\r\n` +
      `*         pay withdrawal fees: ${botAddress}\r\n` +
      `***`;
    console.log(initMsg);
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
      if (!(await this.prisma.botUserExists())) {
        this._log(DB, 'initializing default bot account');
        await this._saveAccount({ forBot: true });
      } else {
        const { userId, hdPrivKey } = await this.prisma.getBotWalletKey();
        keys.push({ userId, hdPrivKey });
      }
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
      const utxos = this.wallets
        .getUtxos()
        .filter(utxo => utxo.userId != BOT.UUID);
      const deposits = await this.prisma.getPlatformDeposits({});
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

  /** Make sure we credit deposits that confirmed while offline */
  private _initConfirmDeposits = async () => {
    this._log(MAIN, `confirming applicable deposits`);
    try {
      const deposits = await this.prisma.getPlatformDeposits({
        unconfirmed: true
      });
      for (const d of deposits) {
        const outpoint = WalletManager.toOutpoint(d);
        const [ result ] = await this.wallets.checkUtxosConfirmed([outpoint]);
        if (result.isConfirmed) {
          await this._confirmDeposit(result.txid);
        }
      }
    } catch (e: any) {
      throw new Error(`_initConfirmDeposits: ${e.message}`);
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

  private _handleUtxoConfirmed = async (
    txid: string
  ) => {
    try {
      this._log(WALLET, `deposit confirmed: ${txid}`);
      await this._confirmDeposit(txid);
    } catch (e: any) {
      throw new Error(`_handleUtxoConfirmed: ${e.message}`);
    }
  };

  private _handleBalanceCommand = async (
    platformId: string,
    message?: Platforms.Message
  ) => {
    this._log(this.platform, `${platformId}: balance command received`);
    try {
      if (!(await this.prisma.isValidUser(platformId))) {
        await this._saveAccount({ platformId });
      }
      const balance = await this.prisma.getAccountBalance(platformId);
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
        ? await this._saveAccount({ platformId })
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
      this._log(
        this.platform,
        `give: ${fromId}: ${fromUsername} -> ${toUsername}: ${sats} sats`
      );
      // Create account for fromId if not exist
      const fromUserId = !(await this.prisma.isValidUser(fromId))
        ? await this._saveAccount({ platformId: fromId })
        : await this.prisma.getUserId(fromId);
      const balance = await this.prisma.getAccountBalance(fromId);
      if (sats > balance) {
        this._log(
          this.platform,
          `give: ${fromUsername} -> ${toUsername}: ` +
          `insufficient balance: ${sats} > ${balance}`
        );
        return;
      }
      // Create account for toId if not exist
      const toUserId = !(await this.prisma.isValidUser(toId))
        ? await this._saveAccount({ platformId: toId })
        : await this.prisma.getUserId(toId);
      // Give successful; save to db
      const timestamp = new Date();
      await this.prisma.saveGive({
        id: Util.newUUID(),
        platform: this.platform.toLowerCase(),
        timestamp,
        fromId: fromUserId,
        toId: toUserId,
        value: sats.toString()
      });
      this._log(
        DB,
        `${this.platform}: give saved: ${fromUsername} -> ${toUsername}`
        );
      // Send Give success reply to chat
      await this.bot.sendGiveReply(
        chatId,
        replyToMessageId,
        fromUsername,
        toUsername,
        Util.toLocaleXPI(sats),
        message
      );
      this._log(
        this.platform,
        `give: ${fromId}: ${fromUsername} -> ${toUsername}: ` +
        `${sats} sats: success: notified user in group`
      );
    } catch (e: any) {
      throw new Error(`_platformHandleGive: ${e.message}`);
    }
  };

  private _handleWithdrawCommand = async (
    platformId: string,
    wAmount: number,
    wAddress: string,
    message?: Platforms.Message
  ) => {
    try {
      this._log(
        this.platform,
        `${platformId}: withdraw command received: ${wAmount} ${wAddress}`
      );
      if (!WalletManager.isValidAddress(wAddress)) {
        this._log(
          this.platform,
          `${platformId}: withdraw: invalid address: ${wAddress}`
        );
        return await this.bot.sendWithdrawReply(
          platformId,
          { error: `address invalid` }
        );
      }
      if (isNaN(wAmount)) {
        this._log(
          this.platform,
          `${platformId}: withdraw: invalid amount: ${wAmount}`
        );
        return await this.bot.sendWithdrawReply(
          platformId,
          { error: `amount invalid` }
        );
      }
      const wSats = Util.toSats(wAmount);
      if (!(await this.prisma.isValidUser(platformId))) {
        await this._saveAccount({ platformId });
      }
      const balance = await this.prisma.getAccountBalance(platformId);
      if (wAmount > balance) {
        this._log(
          this.platform,
          `${platformId}: withdraw: insufficient balance: ${wSats} > ${balance}`
        );
        return await this.bot.sendWithdrawReply(
          platformId,
          { error: 'insufficient balance' }
        );
      }
      const txid = await this.wallets.processWithdrawal(wAddress, wSats);
      this._log(WALLET, `withdrawal accepted: ${txid}`);
      const timestamp = new Date();
      const userId = await this.prisma.getUserId(platformId);
      await this.prisma.saveWithdrawal({
        txid,
        value: Util.toSats(wAmount).toString(),
        timestamp,
        userId
      });
      this._log(DB, `withdrawal saved: ${txid}`);
      await this.bot.sendWithdrawReply(
        platformId,
        { txid, amount: Util.toLocaleXPI(wSats) },
        message
      );
      this._log(
        this.platform,
        `${platformId}: withdraw: user notified of success: ${wSats} sats`
      );
      const totalUtxoBalance = this.wallets.getUtxoBalance();
      this._log(WALLET, `total UTXO balance: ${totalUtxoBalance} sats`);
    } catch (e: any) {
      throw new Error(`_handleWithdrawCommand: ${e.message}`);
    }
  };
  
  /**
   * - Save platform account to database
   * - Load new account `WalletKey` into WalletManager
   * - Return `userId` and `key` from saved account
   */
  private _saveAccount = async ({
    platformId,
    forBot
  }: {
    platformId?: string,
    forBot?: boolean
  }) => {
    try {
      const accountId = forBot ? BOT.UUID : Util.newUUID();
      const userId = forBot ? BOT.UUID : Util.newUUID();
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
    const timestamp = new Date();
    const data = { ...utxo, timestamp };
    try {
      const totalUtxoBalance = this.wallets.getUtxoBalance();
      this._log(WALLET, `total UTXO balance: ${totalUtxoBalance} sats`);
      if (utxo.userId == BOT.UUID) {
        this._log(DB, `deposit is for bot address: skipping`);
        return;
      }
      const deposit = await this.prisma.saveDeposit(data);
      const platformId = deposit.user[this.platform.toLowerCase()].id;
      this._log(DB, `deposit saved: ${utxo.txid}`);
      await this.bot.sendDepositReceived(
        platformId,
        utxo.txid,
        Util.toLocaleXPI(utxo.value)
      );
      this._log(
        this.platform,
        `${platformId}: user notified of deposit received: ${utxo.txid}`
      );
    } catch (e: any) {
      throw new Error(`_saveDeposit: ${e.message}`);
    }
  };

  private _confirmDeposit = async (
    txid: string
  ) => {
    try {
      if (!(await this.prisma.isValidDeposit(txid))) {
        this._log(DB, `deposit invalid (likely bot txid): skipping`);
        return;
      }
      const { user, value } = await this.prisma.confirmDeposit(txid);
      const platformId = user[this.platform.toLowerCase()].id;
      this._log(DB, `deposit confirmed: ${txid}`);
      const balance = await this.prisma.getAccountBalance(platformId);
      await this.bot.sendDepositConfirmed(
        platformId,
        txid,
        Util.toLocaleXPI(value),
        Util.toLocaleXPI(balance)
      );
      this._log(
        this.platform,
        `${platformId}: user notified of deposit confirmed: ${txid}`
      );
    } catch (e: any) {
      throw new Error(`_confirmDeposit: ${e.message}`);
    }
  };

};