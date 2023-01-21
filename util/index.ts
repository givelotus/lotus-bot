import * as Constants from './constants';
import { randomUUID } from 'node:crypto';

export const toSats = (
  xpi: number | string
) => Number(xpi) * Constants.XPI_DIVISOR;

export const toXPI = (
  sats: number | string
) => Number(sats) / Constants.XPI_DIVISOR;

export const toLocaleXPI = (
  sats: number | string
) => toXPI(sats).toLocaleString('en', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6
});

export const parseGive = (
  text: string
) => {
  const parts = split(text);
  const index = parts.findIndex(part => part.toLowerCase() == '/give');
  return index >= 0
    ? parts.slice(index + 1, index + 2).pop()
    : null;
};

export const parseWithdraw = (
  text: string
) => {
  const parts = split(text);
  const index = parts.findIndex(part => part.toLowerCase() == '/withdraw');
  return index >= 0
    ? parts.slice(index + 1, index + 3)
    : null;
};

export const newUUID = () => randomUUID();

const split = (text: string) => text.split(/\s+|\r?\n/);