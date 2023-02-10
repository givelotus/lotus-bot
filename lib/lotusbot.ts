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

const { MIN_OUTPUT_AMOUNT } = TRANSACTION;

export default class LotusBot {
  private prisma: Database;
  private wallets: WalletManager;
  private bots: { [name: string]: Platforms.Platform } = {};

  constructor() {
    this.prisma = new Database();
    this.wallets = new WalletManager();
    this.bots['telegram'] = new Platforms.Telegram();
    this.bots['twitter'] = new Platforms.Twitter();
    this.bots['discord'] = new Platforms.Discord();
  };

  init = async () => {
    process.on('SIGINT', this._shutdown);
    try {
      await this._initPrisma();
      await this._initWalletManager();
      await this._initBots();
      await this._initReconcileDeposits();
    } catch (e: any) {
      this._log(MAIN, `init: ${e.message}`);
      this._log(MAIN, 'shutting down');
      await this._shutdown();
    }
    // Set up event handlers once we are ready
    this.wallets.on('AddedToMempool', this._handleUtxoAddedToMempool);
    for (const platform of Object.keys(this.bots)) {
      this.bots[platform].on('Balance', this._handleBalanceCommand);
      this.bots[platform].on('Deposit', this._handleDepositCommand);
      this.bots[platform].on('Give', this._handleGiveCommand);
      this.bots[platform].on('Withdraw', this._handleWithdrawCommand);
      this.bots[platform].on('Link', this._handleLinkCommand);
    }
    this._log(MAIN, "service initialized successfully");
  };

  private _initBots = async () => {
    for (const [ platform, apiKey ] of Object.entries(config.apiKeys)) {
      // Skip platforms not configured
      if (!apiKey) {
        continue;
      }
      try {
        await this.bots[platform].setup(apiKey);
        await this.bots[platform].launch();
        this._log(platform, `initialized`);
      } catch (e: any) {
        throw new Error(`_initBot: ${e.message}`);
      }
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

  private _log = (
    module: string,
    message: string
  ) => console.log(`${module.toUpperCase()}: ${message}`);

  private _logPlatformNotifyError = (
    platform: string,
    msg: string,
    error: string
  ) => this._log(platform, `${msg} failed to notify user: ${error}`);

  private _shutdown = async () => {
    console.log();
    this._log(`process`, `shutting down`);
    await this.bots['telegram']?.stop();
    await this.bots['twitter']?.stop();
    await this.bots['discord']?.stop();
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
      throw new Error(`_handleUtxoAddedToMempool: ${e.message}`);
    }
  };

  private _handleBalanceCommand = async (
    platform: string,
    platformId: string,
    message?: Platforms.Message
  ) => {
    this._log(platform, `${platformId}: balance command received`);
    try {
      const {
        accountId,
        userId
      } = !(await this.prisma.isValidUser(platform, platformId))
        ? await this._saveAccount(platform, platformId)
        : await this.prisma.getIds(platform, platformId);
      const balance = await this.wallets.getAccountBalance(accountId);
      await this.bots[platform].sendBalanceReply(
        platformId,
        Util.toLocaleXPI(balance),
        message
      );
      this._log(
        platform,
        `${platformId}: user notified of balance: ${balance} sats`
      );
    } catch (e: any) {
      throw new Error(`_handleBalanceCommand: ${e.message}`);
    }
  };
  /** Gather user's address and send back to user as reply to their message */
  private _handleDepositCommand = async (
    platform: string,
    platformId: string,
    message?: Platforms.Message
  ) => {
    try {
      this._log(platform, `${platformId}: deposit command received`);
      const { userId } = !(await this.prisma.isValidUser(platform, platformId))
        ? await this._saveAccount(platform, platformId)
        : await this.prisma.getIds(platform, platformId);
      const address = this.wallets.getKey(userId)?.address?.toXAddress();
      await this.bots[platform].sendDepositReply(platformId, address, message);
      this._log(platform, `${platformId}: deposit: address sent to user`);
    } catch (e: any) {
      throw new Error(`_platformHandleDeposit: ${e.message}`);
    }
  };

  private _handleGiveCommand = async (
    platform: string,
    chatId: string,
    replyToMessageId: number,
    fromId: string,
    fromUsername: string,
    toId: string,
    toUsername: string,
    value: string,
    message?: Platforms.Message
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
      } = !(await this.prisma.isValidUser(platform, fromId))
        ? await this._saveAccount(platform, fromId)
        : await this.prisma.getIds(platform, fromId);
      const balance = await this.wallets.getAccountBalance(fromAccountId);
      if (sats > balance) {
        this._log(platform, msg + `insufficient balance: ${balance}`);
        return;
      }
      // Create account for toId if not exist
      const {
        userId: toUserId
      } = !(await this.prisma.isValidUser(platform, toId))
        ? await this._saveAccount(platform, toId)
        : await this.prisma.getIds(platform, toId);
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
          Util.toLocaleXPI(sats),
          message
        );
        this._log(platform, msg + `success: user notified`);
      } catch (e: any) {
        this._logPlatformNotifyError(platform, msg, e.message);
      }
    } catch (e: any) {
      throw new Error(`_platformHandleGive: ${e.message}`);
    }
  };

  private _handleWithdrawCommand = async (
    platform: string,
    platformId: string,
    outAmount: number,
    outAddress: string,
    message?: Platforms.Message
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
            `${Util.toLocaleXPI(MIN_OUTPUT_AMOUNT)} XPI`
          },
          message
        );
      }
      const isValidUser = await this.prisma.isValidUser(platform, platformId);
      const { accountId, userId } = !isValidUser
        ? await this._saveAccount(platform, platformId)
        : await this.prisma.getIds(platform, platformId);
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
          { txid: tx.txid, amount: Util.toLocaleXPI(outSats) },
          message
        );
        this._log(
          platform,
          msg + `user notified: ${outSats} sats: ${tx.txid}`
        );
      } catch (e: any) {
        this._logPlatformNotifyError(platform, msg, e.message);
      }
    } catch (e: any) {
      throw new Error(`_handleWithdrawCommand: ${e.message}`);
    }
  };

  private _handleLinkCommand = async (
    platform: string,
    platformId: string,
    secret: string | undefined,
    message?: Platforms.Message
  ) => {
    this._log(platform, `${platformId}: link command received`);
    const msg = `${platformId}: link: ${secret ? '<redacted>' : 'initiate'}: `;
    let error: string;
    try {
      switch (typeof secret) {
        /** User provided secret to link account */
        case 'string':
          // Get the accountId associated with the user with the secret
          const linkAccountId = await this.prisma.getAccountIdFromSecret(secret);
          const {
            accountId,
            userId
          } = await this.prisma.getIds(platform, platformId);
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
          this.wallets.updateKey(linkAccountId, userId);
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
      throw new Error(`_handleLinkCommand: ${e.message}`);
    }
  };
  
  /**
   * - Save platformId/user/account to database
   * - Load new account `WalletKey` into WalletManager
   * - Return `userId` from saved account
   */
  private _saveAccount = async (
    platform: string,
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
      for (const [platform, platformUser] of Object.entries(deposit.user)) {
        const platformId = platformUser?.id;
        if (!platformId) {
          continue;
        }
        const accountId = await this.prisma.getAccountId(platform, platformId);
        const balance = await this.wallets.getAccountBalance(accountId);
        // try to notify user of deposit received
        try {
          await this.bots[platform].sendDepositReceived(
            platformId,
            utxo.txid,
            Util.toLocaleXPI(utxo.value),
            Util.toLocaleXPI(balance)
          );
          this._log(
            platform,
            `${platformId}: user notified of deposit received: ${utxo.txid}`
          );
        } catch (e: any) {
          this._log(
            platform,
            `failed to notify user of deposit received: ${e.message}`
          );
        }
        break;
      }
      // const platformId = deposit.user[this.platform.toLowerCase()].id;
    } catch (e: any) {
      throw new Error(`_saveDeposit: ${e.message}`);
    }
  };

};