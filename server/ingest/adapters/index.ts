import type { SourceAdapter } from '../types.js';
import { cbarCpi, cbarRates } from './cbar.js';
import { bankAdapters } from './banks/index.js';

export const adapters = (): SourceAdapter[] => [cbarRates, cbarCpi, ...bankAdapters()];
