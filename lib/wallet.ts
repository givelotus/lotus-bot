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
  ScriptType,
  SubscribeMsg,
  Utxo,
  WsEndpoint
} from 'chronik-client';
import config from '../config';
import { WALLET } from '../util/constants';
import { EventEmitter } from 'node:stream';

type WalletKey = {
  signingKey: PrivateKey;
  address: Address;
  script: Script;
  scriptHex: string;
  scriptType: ScriptType;
  utxos: ParsedUtxo[];
};

type ParsedUtxo = {
  txid: string;
  outIdx: number;
  value: string;
};

export type AccountUtxo = ParsedUtxo & {
  userId: string
}

export declare interface WalletManager {
  on(event: 'AddedToMempool', callback: (utxo: ParsedUtxo) => void): this;
  on(event: 'Confirmed', callback: (txid: string) => void): this;
};

export class WalletManager extends EventEmitter {
  // Chronik properties
  private chronik: ChronikClient;
  private chronikWs: WsEndpoint;
  // Wallet properties
  private keys: { [userId: string]: WalletKey } = {};
  private utxos: ParsedUtxo[] = [];
  /**
   * Holds latest tx that has triggered Chronik WS
   * Avoids processing the same txid twice (e.g. when a Give occurs)
   */
  private lastChronikTx: string;
  /** Provides all off- and on-chain wallet functionality */
  constructor() {
    super();
    this.chronik = new ChronikClient(config.wallet.chronikUrl);
    this.chronikWs = this.chronik.ws({
      onMessage: this._chronikHandleWsMessage
    });
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
      throw new Error(`WalletManager: init: ${e.message}`);
    }
  };
  /** Unsubscribe from and close Chronik WS */
  closeWsEndpoint = () => {
    for (const userId in this.keys) {
      const { scriptType, scriptHex } = this.keys[userId];
      this.chronikWs.unsubscribe(scriptType, scriptHex);
    }
    this.chronikWs.close();
  };
  /** Get the UTXOs for every `WalletKey` */
  getUtxos = () => {
    const utxos: AccountUtxo[] = [];
    for (const [ userId, key ] of Object.entries(this.keys)) {
      const accountUtxos = key.utxos.map(utxo => {
        return { ...utxo, userId };
      });
      utxos.push(...accountUtxos);
    }
    return utxos;
  };
  /** Get the UTXO balance for the provided `userId` */
  getUserBalance = async (
    userId: string
  ) => {
    // Reconcile sender UTXOs before generating and broadcasting tx
    await this._reconcileUtxos(userId);
    const utxos = this.keys[userId].utxos;
    const sats = { total: 0 };
    utxos.forEach(utxo => sats.total += Number(utxo.value));
    return sats.total;
  };
  /** Return single `WalletKey` of `userId` */
  getKey = (
    userId: string
  ): WalletKey | undefined => {
    return this.keys[userId];
  };
  /** Check if given outpoint(s) have been confirmed by network */
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
   * - download UTXOs from Chronik and store `ParsedUtxo`s
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
      const scriptType = this._chronikScriptType(address);
      const scriptHex = script.getPublicKeyHash().toString('hex');
      const utxos = await this._getUtxos(scriptType, scriptHex);
      const parsedUtxos = utxos?.map(utxo => this._toParsedUtxo(utxo));
      this.keys[userId] = {
        signingKey,
        address,
        script,
        scriptHex,
        scriptType,
        utxos: parsedUtxos
      }
      this.chronikWs.subscribe(scriptType, scriptHex);
    } catch (e: any) {
      throw new Error(`loadKey: ${userId}: ${e.message}`);
    }
  };
  /** Process Give/Withdraw tx for the provided `fromUserId` */
  processTx = async ({
    fromUserId,
    toUserId,
    outAddress,
    sats
  }: {
    fromUserId: string,
    toUserId?: string,
    outAddress?: string,
    sats: number
  }) => {
    try {
      const { tx, utxoCount } = this._genTx(
        this.keys[fromUserId],
        this.keys[fromUserId].utxos,
        outAddress || this.keys[toUserId].address,
        sats
      );
      const txid = await this._broadcastTx(tx);
      this.keys[fromUserId].utxos.splice(0, utxoCount);
      return txid;
    } catch (e: any) {
      throw new Error(`processTx: ${e.message}`);
    }
  };
  /** Generate transaction for `WalletKey` using provided `utxos` */
  private _genTx = (
    key: WalletKey,
    utxos: ParsedUtxo[],
    outAddress: string | Address,
    outSats: number
  ) => {
    const used = { count: 0 };
    const tx = new Transaction();
    try {
      for (const utxo of utxos) {
        tx.addInput(this._toPKHInput(utxo, key.script));
        used.count++;
        if (tx.inputAmount > outSats) {
          break;
        }
      }
      const outScript = this._getScriptFromAddress(outAddress);
      tx.addOutput(this._toOutput(outSats, outScript));
      // Adjust output amount to accommodate fees if no extra XPI available
      if (tx.inputAmount == outSats) {
        const sats = outSats - (tx._estimateSize() * config.tx.feeRate);
        tx.removeOutput(0);
        tx.addOutput(this._toOutput(sats, outScript));
      } else {
        tx.feePerByte(config.tx.feeRate);
        tx.change(key.address);
      }
      tx.sign(key.signingKey);
      const verified = tx.verify();
      switch (typeof verified) {
        case 'boolean':
          return { tx, utxoCount: used.count };
        case 'string':
          throw new Error(verified);
      }
    } catch (e: any) {
      throw new Error(`_genTx: ${e.message}`);
    }
  };
  private _broadcastTx = async (
    tx: Transaction
  ) => {
    try {
      const txBuf = tx.toBuffer();
      const broadcasted = await this.chronik.broadcastTx(txBuf);
      return broadcasted.txid;
    } catch (e: any) {
      throw new Error(`_broadcastTx: ${e.message}`);
    }
  };
  /**
   * Ensure Chronik `AddedToMempool` doesn't corrupt the in-memory UTXO set
   */
  private _isExistingUtxo = (
    userId: string,
    utxo: ParsedUtxo
  ) => {
    return this.keys[userId].utxos.find(existing => {
      return existing.txid == utxo.txid
        && existing.outIdx == utxo.outIdx
    });
  }
  /** Fetch UTXOs from Chronik API for provided `WalletKey` */
  private _getUtxos = async (
    scriptType: ScriptType,
    scriptHex: string,
  ): Promise<Utxo[]> => {
    try {
      const scriptEndpoint = this.chronik.script(scriptType, scriptHex);
      const [ result ] = await scriptEndpoint.utxos();
      return result?.utxos || [];
    } catch (e: any) {
      throw new Error(`_getUtxos: ${e.message}`);
    }
  };
  /** Remove spent and otherwise invalid UTXOs from user's `WalletKey` */
  private _reconcileUtxos = async (
    userId: string
  ) => {
    try {
      const outpoints: OutPoint[] = []
      for (const utxo of this.keys[userId].utxos) {
        outpoints.push(WalletManager.toOutpoint(utxo));
      }
      const result = await this.chronik.validateUtxos(outpoints);
      for (let i = 0; i < result.length; i++) {
        switch (result[i].state) {
          case 'NO_SUCH_TX':
          case 'NO_SUCH_OUTPUT':
          case 'SPENT':
            this.keys[userId].utxos.splice(i, 1);
        }
      }
    } catch (e: any) {
      throw new Error(`_consolidateUtxos: ${e.message}`);
    }
  };
  /**
   * Derive single `PrivateKey` from account's `HDPrivateKey`
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
  /**
   * Convert `PrivateKey` into `Address`
   */
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
  /** Detect and process Chronik WS messages */
  private _chronikHandleWsMessage = async (
    msg: SubscribeMsg
  ) => {
    try {
      if (
        msg.type == 'AddedToMempool' ||
        msg.type == 'Confirmed'
      ) {
        if (this.lastChronikTx == msg.txid) {
          return;
        }
        this.lastChronikTx = msg.txid;
        const { outputs } = await this.chronik.tx(msg.txid);
        const outScripts = outputs.map(output => output.outputScript);
        // process each tx output
        for (let i = 0; i < outScripts.length; i++) {
          const scriptHex = outScripts[i];
          // find userId/key matching output scriptHex
          for (const [ userId, key ] of Object.entries(this.keys)) {
            const userScriptHex = key.script.toHex();
            if (userScriptHex != scriptHex) {
              continue;
            }
            const parsedUtxo = {
              txid: msg.txid,
              outIdx: i,
              value: outputs[i].value,
            };
            switch (msg.type) {
              case 'AddedToMempool':
                if (this._isExistingUtxo(userId, parsedUtxo)) {
                  continue;
                }
                this.keys[userId].utxos.push(parsedUtxo);
                this.emit('AddedToMempool', {
                  ...parsedUtxo,
                  userId
                });
                break;
              case 'Confirmed':
                this.emit('Confirmed', msg.txid);
                break;
            }
          }
        }
      }
    } catch (e: any) {
      throw new Error(`_chronikHandleWsMessage: ${e.message}`);
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
  private _toParsedUtxo = (
    utxo: Utxo
  ) => {
    const { txid, outIdx } = utxo.outpoint;
    const { value } = utxo;
    return { txid, outIdx, value };
  };
  /** Create Bitcore-compatible P2PKH `Transaction.Input` */
  private _toPKHInput = (
    utxo: ParsedUtxo,
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
  /** Gets `HDPrivateKey` from mnemonic seed buffer */
  static newHDPrivateKey = (
    mnemonic: Mnemonic
  ) => HDPrivateKey.fromSeed(mnemonic.toSeed());
  /** Instantiate Prisma HDPrivateKey buffer as `HDPrivateKey` */
  static hdPrivKeyFromBuffer = (
    hdPrivKeyBuf: Buffer
  ) => new HDPrivateKey(hdPrivKeyBuf);
  static toOutpoint = (
    utxo: ParsedUtxo
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