import * as Constants from './constants';
import { randomUUID } from 'node:crypto';

export const toSats = (
  xpi: number | string
) => Math.round(Number(xpi) * Constants.XPI_DIVISOR);


export const toXPI = (
  sats: number | string
) => Number(sats) / Constants.XPI_DIVISOR;

export const toLocaleXPI = (
  sats: number | string
) => toXPI(sats).toLocaleString('en', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6
});

export const newUUID = () => randomUUID();
export const split = (text: string) => text.split(/\s+|\r?\n/);