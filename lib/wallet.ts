import {
  Address,
  HDPrivateKey,
  PrivateKey,
  Script,
  Transaction,
} from '../local_modules/bitcore-lib-xpi';
import Mnemonic from '@abcpros/bitcore-mnemonic';
import {
  ChronikClient,
  OutPoint,
  ScriptEndpoint,
  ScriptType,
  SubscribeMsg,
  Utxo,
  WsEndpoint
} from 'chronik-client';
import config from '../config';
import {
  BOT,
  WALLET,
  TRANSACTION,
} from '../util/constants';
import { EventEmitter } from 'node:stream';

export type WalletKey = {
  userId: string;
  signingKey: PrivateKey;
  address: Address;
  script: Script;
  scriptHex: string;
  scriptType: ScriptType;
};

export type AccountUtxo = {
  txid: string;
  outIdx: number;
  value: string;
  userId: string;
};

export declare interface WalletManager {
  on(event: 'AddedToMempool', callback: (utxo: AccountUtxo) => void): this;
  on(event: 'Confirmed', callback: (txid: string) => void): this;
};

export class WalletManager extends EventEmitter {
  // Chronik properties
  private chronik: ChronikClient;
  private chronikWs: WsEndpoint;
  // Wallet properties
  private keys: WalletKey[] = [];
  private utxos: AccountUtxo[] = [];
  /**
   * Provides all off- and on-chain functionality for all users' Wallet Keys.
   */
  constructor() {
    super();
    this.chronik = new ChronikClient(config.wallet.chronikUrl);
    this.chronikWs = this.chronik.ws({
      onMessage: this._chronikHandleWsMessage
    });
    // this.mnemonic = config.wallet.mnemonic;
    // this.hdPrivKey = HDPrivateKey.fromSeed(this._getMnemonicSeedBuffer());
  };
  /** 
   * - Initialize Chronik WS
   * - load user accounts (keys, UTXOs, WS subscription)
   */
  init = async (
    users: Array<{
      userId: string,
      hdPrivKey: HDPrivateKey
    }>
  ) => {
    try {
      for (const user of users) {
        await this.loadKey(user);
      }
    } catch (e: any) {
      throw new Error(`init: ${e.message}`);
    }
  };
  closeWsEndpoint = () => {
    for (const key of this.keys) {
      this._chronikWsUnsubscribe(key);
    }
    this.chronikWs.close();
  };
  getBotAddress = () => this.getKey(BOT.UUID).address;
  getUtxos = () => this.utxos;
  getUtxoBalance = () => {
    return this.utxos
      .reduce((prev, curr) => prev + Number(curr.value), 0);
  };
  getKey = (
    userId: string
  ): WalletKey | undefined => {
    return this.keys.find(key => key.userId == userId);
  };
  checkUtxosConfirmed = async (
    outpoints: OutPoint[]
  ) => {
    try {
      const result = await this.chronik.validateUtxos(outpoints);
      return result.map((state, idx) => {
        return {
          txid: outpoints[idx].txid,
          isConfirmed: state.isConfirmed
        };
      })
    } catch (e: any) {
      throw new Error(`isUtxoConfirmed: ${e.message}`);
    }
  };
  /** 
   * - load wallet signingKey, script, address
   * - download UTXOs from Chronik API and store `AccountUtxo`s
   * - subscribe to Chronik WS
   */
  loadKey = async ({
    userId,
    hdPrivKey
  }: {
    userId: string,
    hdPrivKey: HDPrivateKey
  }) => {
    try {
      const signingKey = this._getDerivedSigningKey(hdPrivKey);
      const address = this._getAddressFromSigningKey(signingKey);
      const script = this._getScriptFromAddress(address);
      const scriptHex = script.getData().toString('hex');
      const scriptType = this._chronikScriptType(address);
      const key = {
        userId,
        signingKey,
        address,
        script,
        scriptHex,
        scriptType
      };
      this.keys.push(key);

      const utxos = await this._getUtxos(key);
      const AccountUtxos = utxos?.map(utxo => this._toAccountUtxo(userId, utxo));
      this.utxos.push(...AccountUtxos);

      this._chronikWsSubscribe(key);
    } catch (e: any) {
      throw new Error(`loadKey: ${userId}: ${e.message}`);
    }
  };
  /**
   * - Allocate UTXOs for tx inputs
   * - Set change address if necessary
   * - Sign tx
   * - Broadcast tx
   * - Remove spent UTXOs from in-memory set
   * 
   * Return `txid` after broadcasting with Chronik API
   */
  processWithdrawal = async (
    wAddress: string,
    wSats: number
  ): Promise<string> => {
    // Setup output parameters
    const wScript = this._getScriptFromAddress(wAddress);
    // TODO: check User's balance against withdrawal amount
    // Gather UTXOs to use for inputs until amount > wSats + fee
    const signingKeys = [];
    const changeAddress = this.getBotAddress();
    const tx = new Transaction();
    try {
      // holds UTXOs that are spent in tx
      // these are removed from in-memory set when spend successful
      const spentUtxos: AccountUtxo[] = [];
      for (const utxo of this.utxos) {
        const key = this.getKey(utxo.userId);
        tx.addInput(this._toPKHInput(utxo, key.script));
        signingKeys.push(key.signingKey);
        spentUtxos.push(utxo);
        if (tx.inputAmount > wSats + TRANSACTION.FEE) {
          break;
        }
      };
      tx.addOutput(this._toOutput(wSats, wScript));
      tx.feePerByte(config.tx.feeRate);
      tx.change(changeAddress);
      tx.sign(signingKeys);
      // Transaction sanity check; throw if verification failed
      const verified = tx.verify();
      switch (typeof verified) {
        case 'boolean':
          const txBuf = tx.toBuffer();
          const broadcasted = await this.chronik.broadcastTx(txBuf);
          // Remove spent (now invalid) UTXOs from in-memory set
          spentUtxos.forEach(spent => {
            const index = this.utxos.findIndex(utxo => spent.txid == utxo.txid);
            this.utxos.splice(index, 1)
          });
          // Return txid of withdrawal to send to user
          return broadcasted.txid;
        case 'string':
          throw new Error(verified);
      }
    } catch (e: any) {
      throw new Error(`processWithdrawal: ${e.message}`);
    }
  };
  /**
   * Ensure Chronik `AddedToMempool` doesn't corrupt the in-memory UTXO set
   */
  private _isExistingUtxo = (
    utxo: AccountUtxo
  ) => {
    return this.utxos.find(existing => {
      return existing.txid == utxo.txid
        && existing.outIdx == utxo.outIdx
    });
  }
  /** Fetch UTXOs from Chronik API for provided `WalletKey` */
  private _getUtxos = async (
    key: WalletKey
  ): Promise<Utxo[]> => {
    try {
      const scriptEndpoint = this._chronikScriptEndpoint(key);
      const [ result ] = await scriptEndpoint.utxos();
      return result?.utxos || [];
    } catch (e: any) {
      throw new Error(`_getUtxos: ${e.message}`);
    }
  };
  private _getHDPrivateKey = (
    mnemonic: string
  ) => {
    try {
      const seed = new Mnemonic(mnemonic).toSeed();
      return HDPrivateKey.fromSeed(seed);
    } catch (e: any) {
      throw new Error(`getHDPrivateKey: ${e.message}`);
    }
  };
  /**
   * Gets the derived privkey for `keyIdx` from the specified chain. 
   * If external address, chain is `0`; if change address, chain is `1`.
   * 
   * Defaults to `keyIdx` of 0 for the Bot's signing key
   * 
   * Example external address: `m/44'/10605'/0'/0/7`
   * Example change address: `m/44'/10605'/0'/1/2`
   */
  private _getDerivedSigningKey = (
    hdPrivKey: HDPrivateKey
  ): PrivateKey => {
    try {
      return hdPrivKey
        .deriveChild(WALLET.PURPOSE, true)
        .deriveChild(WALLET.COINTYPE, true)
        .deriveChild(0, true)
        .deriveChild(0)
        .deriveChild(0).privateKey;
    } catch (e: any) {
      throw new Error(`getDerivedPrivKey: ${e.message}`);
    }
  };
  /** Gets the account's external deposit address */
  private _getAddressFromSigningKey = (
    signingKey: PrivateKey
  ): Address => {
    try {
      return signingKey.toAddress();
    } catch (e: any) {
      throw new Error(`_getAddressFromSigningKey: ${e.message}`);
    }
  };
  /** Convert `Address` string or class to `Script` */
  private _getScriptFromAddress = (
    address: string | Address
  ): Script => {
    try {
      return Script.fromAddress(address);
    } catch (e: any) {
      throw new Error(`_getScriptFromAddress: ${e.message}`);
    }
  };
  /** Converts configured 12-word mnemonic to a seed `Buffer` */
  private _getMnemonicSeedBuffer = (
    mnemonic: string
  ): Buffer => {
    try {
      return new Mnemonic(mnemonic).toSeed();
    } catch (e: any) {
      throw new Error(`_getMnemonicSeedBuffer: ${e.message}`);
    }
  };
  /** Subscribe `Script` to Chronik WS for UTXO updates */
  private _chronikWsSubscribe = (
    key: WalletKey
  ) => {
    this.chronikWs.subscribe(key.scriptType, key.scriptHex);
  };
  /** Unsubscribe `Script` from Chronik WS */
  private _chronikWsUnsubscribe = (
    key: WalletKey
  ) => {
    this.chronikWs.unsubscribe(key.scriptType, key.scriptHex);
  };
  /** Detect and process Chronik WS messages */
  private _chronikHandleWsMessage = async (
    msg: SubscribeMsg
  ) => {
    try {
      switch (msg.type) {
        /**
         * New user deposit detected in mempool
         */
        case 'AddedToMempool':
          const { outputs } = await this.chronik.tx(msg.txid);
          const outScripts = outputs.map(output => output.outputScript);
          const key = this.keys.find(key => {
            return outScripts.includes(key.script.toHex());
          });
          const outIdx = outScripts.findIndex(
            outScript => key.script.toHex() == outScript
          );
          const accountUtxo = {
            txid: msg.txid,
            outIdx,
            value: outputs[outIdx].value,
            userId: key.userId
          };
          if (this._isExistingUtxo(accountUtxo)) {
            return;
          }
          this.utxos.push(accountUtxo);
          return this.emit('AddedToMempool', accountUtxo);
        /**
         * User deposit confirmed
         */
        case 'Confirmed':
          return this.emit('Confirmed', msg.txid);
      }
    } catch (e: any) {
      throw new Error(`_chronikHandleWsMessage: ${e.message}`);
    }
  };
  /** Get Chronik `ScriptEndpoint` from `WalletKey` */
  private _chronikScriptEndpoint = (
    key: WalletKey
  ): ScriptEndpoint => {
    try {
      return this.chronik.script(key.scriptType, key.scriptHex);
    } catch (e: any) {
      throw new Error(`_chronikScriptEndpoint: ${e.message}`);
    }
  };
  /** Return the Chronik `ScriptType` from provided `Address` */
  private _chronikScriptType = (
    address: Address
  ): ScriptType => {
    switch (true) {
      case address.isPayToPublicKeyHash():
        return 'p2pkh';
      case address.isPayToScriptHash():
        return 'p2sh';
      default:
        return 'other';
    };
  };
  private _toAccountUtxo = (
    userId: string,
    utxo: Utxo
  ) => {
    const { txid, outIdx } = utxo.outpoint;
    const { value } = utxo;
    return { txid, outIdx, value, userId };
  };
  /** Create Bitcore-compatible P2PKH `Transaction.Input` */
  private _toPKHInput = (
    utxo: AccountUtxo,
    script: Script
  ) => {
    try {
      return new Transaction.Input.PublicKeyHash({
        prevTxId: utxo.txid,
        outputIndex: utxo.outIdx,
        output: this._toOutput(Number(utxo.value), script),
        script
      });
    } catch (e: any) {
      throw new Error(`_toPKHInput: ${e.message}`);
    }
  };
  /** Create a Bitcore-compatible `Transaction.Output` */
  private _toOutput = (
    satoshis: number,
    script: Script,
  ) => {
    try {
      return new Transaction.Output({ satoshis, script });
    } catch (e: any) {
      throw new Error(`_toOutput: ${e.message}`);
    }
  };
  /** Generates a new 12-word mnemonic phrase */
  static newMnemonic = () => new Mnemonic();
  static newHDPrivateKey = (
    mnemonic: Mnemonic
  ) => HDPrivateKey.fromSeed(mnemonic.toSeed());
  static hdPrivKeyFromBuffer = (
    hdPrivKeyBuf: Buffer
  ) => new HDPrivateKey(hdPrivKeyBuf);
  static toOutpoint = (
    utxo: AccountUtxo
  ): OutPoint => {
    return {
      txid: utxo.txid,
      outIdx: utxo.outIdx
    };
  };
  static isValidAddress = (
    address: string
  ) => Address.isValid(address);

};