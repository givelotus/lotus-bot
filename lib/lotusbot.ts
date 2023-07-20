import {
  Platforms,
  PlatformName,
  Platform,
} from './platforms';
import config from '../config';
import { WalletManager } from './wallet';
import { Database } from './database';
import { Handler } from './handler';

// Constants used for logging purposes
const WALLET = 'walletmanager';
const DB = 'prisma';
const MAIN = 'lotusbot';
/**
 * Master class  
 * Processes all platform commands  
 * Handles communication between submodules
 */
export default class LotusBot {
  private prisma: Database;
  private wallet: WalletManager;
  private handler: Handler;
  private bots: { [platform in PlatformName]?: Platform } = {};
  /** Hold enabled platforms */
  private platforms: [name: PlatformName, apiKey: string][] = [];

  constructor() {
    this.prisma = new Database();
    this.wallet = new WalletManager();
    this.handler = new Handler(this.prisma, this.wallet);
    // Handler events
    this.handler.on('Shutdown', this._shutdown);
    this.handler.on('DepositSaved', this._depositSaved);
    /** Gather enabled platforms */
    for (const [ platform, apiKey ] of Object.entries(config.apiKeys)) {
      const name = platform as PlatformName;
      if (apiKey) {
        this.platforms.push([name, apiKey]);
        this.bots[name] = new Platforms[name](this.handler);
      }
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
  ) => this._log(platform, `${msg}: failed to notify user: ${error}`);
  /**
   * Initialize all submodules  
   * Set up required event handlers
   */
  init = async () => {
    process.on('SIGINT', this._shutdown);
    try {
      /**
       * Initialize Prisma module:  
       * - Connect to the database
       */
      try {
        await this.prisma.connect();
        this._log(DB, 'initialized');
      } catch (e: any) {
        throw new Error(`initPrisma: ${e.message}`);
      }
      /**
       * Initialize WalletManager module:  
       * - Get all WalletKeys from database
       * - Load all WalletKeys into WalletManager
       */
      try {
        const keys = await this.prisma.getUserWalletKeys();
        await this.wallet.init(
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
        throw new Error(`initWalletManager: ${e.message}`);
      }
      /**
       * Initialize all configured bot modules  
       * A bot module is considered enabled if the `.env` includes `APIKEY` entry
       */
      for (const [ name, apiKey ] of this.platforms) {
        try {
          await this.bots[name].setup(apiKey);
          await this.bots[name].launch();
          this._log(name, `initialized`);
        } catch (e: any) {
          throw new Error(`initBot: ${name}: ${e.message}`);
        }
      }
      /**
       * Initialize primary command handler module
       */
      await this.handler.init();
    } catch (e: any) {
      this._log(MAIN, `FATAL: init: ${e.message}`);
      await this._shutdown();
    }
    this._log(MAIN, "service initialized successfully");
  };
  /** Shutdown all submodules */
  private _shutdown = async () => {
    console.log();
    this._log(MAIN, 'shutting down');
    /** Shutdown enabled platforms */
    for (const [ name ] of this.platforms) {
      await this.bots[name].stop();
    }
    this.wallet?.closeWsEndpoint();
    await this.prisma?.disconnect();
    process.exit(1);
  };

  private _depositSaved = async ({
    platform,
    platformId,
    txid,
    amount,
    balance
  }: {
    platform: PlatformName,
    platformId: string,
    txid: string,
    amount: string,
    balance: string
  }) => {
    // try to notify user of deposit received
    try {
      await this.bots[platform].sendDepositReceived(
        platformId,
        txid,
        amount,
        balance
      );
      this._log(
        platform,
        `${platformId}: user notified of deposit received: ${txid}`
      );
    } catch (e: any) {
      this._logPlatformNotifyError(platform, '_depositSaved', e.message);
    }
  };

};