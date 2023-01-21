// Utilities
export const XPI_DIVISOR = 1000000;

// Default bot database properties
export const BOT = {
  UUID: "00000000-0000-0000-0000-000000000000"
};

// BIP44 Wallet parameters
export const WALLET = {
  PURPOSE: 44,
  COINTYPE: 10605,
};

// Default transaction parameters
export const TRANSACTION = {
  /** Default withdrawal fee, in satoshis */
  FEE: 10000,
  /** Default withdrawal fee rate, in satoshis */
  FEE_RATE: 2,
  /** Default output dust limit */
  DUST_LIMIT: 546,
}