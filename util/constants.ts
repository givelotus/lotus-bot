// Utilities
export const XPI_DIVISOR = 1000000;

// Default bot database properties
export const BOT = {
  MESSAGE: {
    ERR_DM_COMMAND: 'Please send me this command in a DM',
    ERR_NOT_DM_COMMAND: 'This command does not work in a DM',
    ERR_GIVE_MUST_REPLY_TO_USER:
      'You must reply to another user to give Lotus',
    ERR_AMOUNT_INVALID: 'Invalid amount specified',
    ERR_GIVE_TO_BOT:
      'I appreciate the thought, but you cannot give me Lotus. :)',
    GIVE:
      `%s, you have given %s XPI to %s! 🪷\r\n\r\n` +
      `[View tx on the Explorer](%s)`,
    RECEIVE: `%s, you have received %s XPI from %s! 🪷`,
    BALANCE: 'Your balance is %s XPI',
    DEPOSIT:
      `Send Lotus here to fund your account: \`%s\`\r\n\r\n` +
      `[View address on the Explorer](%s)`,
    DEPOSIT_RECV:
      `I received your deposit of %s XPI. ` +
      `Your balance is now %s XPI.\r\n\r\n` +
      `[View tx on the Explorer](%s)`,
    DEPOSIT_CONF: 
      `Your deposit of %s XPI has been confirmed! ` +
      `Your balance is now %s XPI\r\n\r\n` +
      `[View tx on the Explorer](%s)`,
    WITHDRAW_OK:
      `Your withdrawal of %s XPI was successful!\r\n\r\n` +
      `[View tx on the Explorer](%s)`,
    WITHDRAW_FAIL: `There was an error processing your withdrawal: %s`,
  },
};

// BIP44 Wallet parameters
export const WALLET = {
  PURPOSE: 44,
  COINTYPE: 10605,
};

// Default transaction parameters
export const TRANSACTION = {
  /** Default withdrawal fee, in satoshis */
  FEE: 100000,
  /** Default output dust limit */
  DUST_LIMIT: 546,
  /** Minimum output amount for any Give/Withdraw */
  MIN_OUTPUT_AMOUNT: 1000,
};