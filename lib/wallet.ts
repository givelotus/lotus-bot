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
      this._chronikWsUnsubscribe(key.script);
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
      this.keys.push({ userId, signingKey, address, script });

      const utxos = await this._getUtxos(script);
      const AccountUtxos = utxos?.map(utxo => this._toAccountUtxo(userId, utxo));
      this.utxos.push(...AccountUtxos);

      this._chronikWsSubscribe(script);
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
    const wScript = Script.fromAddress(wAddress);
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
        if (tx._inputAmount > wSats + TRANSACTION.FEE) {
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
  /** Fetch UTXOs from Chronik API for provided `Script` */
  private _getUtxos = async (
    script: Script
  ): Promise<Utxo[]> => {
    try {
      const scriptEndpoint = this._chronikScriptEndpoint(script);
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
  /** Get the `Script` of the account's external deposit `Address` */
  private _getScriptFromAddress = (
    address: Address
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
    script: Script
  ) => {
    const { scriptType, outputScript } = this._chronikScriptData(script);
    this.chronikWs.subscribe(scriptType, outputScript);
  };
  private _chronikWsUnsubscribe = (
    script: Script
  ) => {
    const { scriptType, outputScript } = this._chronikScriptData(script);
    this.chronikWs.unsubscribe(scriptType, outputScript);
  };
  /** Used for detecting and processing user deposits */
  private _chronikHandleWsMessage = async (
    msg: SubscribeMsg
  ) => {
    try {
      switch (msg.type) {
        // New user deposit detected in mempool
        case 'AddedToMempool':
          return await this._chronikWsAddedToMempool(msg.txid);
        // User deposit confirmed
        case 'Confirmed':
          return this.emit('Confirmed', msg.txid);
      }
    } catch (e: any) {
      throw new Error(`_chronikHandleWsMessage: ${e.message}`);
    }
  };
  private _chronikWsAddedToMempool = async (
    txid: string
  ) => {
    try {
      const { outputs } = await this.chronik.tx(txid);
      const outScripts = outputs.map(output => output.outputScript);
      const key = this.keys.find(key => {
        const scriptHex = key.script.toHex();
        return outScripts.includes(scriptHex);
      });
      const scriptHex = key.script.toHex();
      const outIdx = outScripts.findIndex(script => scriptHex == script);
      const accountUtxo = {
        txid,
        outIdx,
        value: outputs[outIdx].value,
        userId: key.userId
      };
      this.utxos.push(accountUtxo);
      return this.emit('AddedToMempool', accountUtxo);
    } catch (e: any) {
      throw new Error(`_chronikWsAddedToMempool: ${e.message}`);
    }
  };
  /** Converts a `Script` into a Chronik `ScriptEndpoint` */
  private _chronikScriptEndpoint = (
    script: Script
  ): ScriptEndpoint => {
    try {
      const { outputScript, scriptType } = this._chronikScriptData(script);
      return this.chronik.script(scriptType, outputScript);
    } catch (e: any) {
      throw new Error(`_chronikScriptEndpoint: ${e.message}`);
    }
  };
  /** Gathers required data for `this.getScriptEndpoint()` */
  private _chronikScriptData = (
    script: Script
  ) => {
    try {
      const scriptType = this._chronikScriptType(script);
      const outputScript = script.getData().toString('hex');
      return { scriptType, outputScript };
    } catch (e: any) {
      throw new Error(`_chronikScriptData: ${e.message}`);
    }
  };
  /** Return the Chronik-compatible `ScriptType` */
  private _chronikScriptType = (
    script: Script
  ): ScriptType => {
    const address = script.toAddress();
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