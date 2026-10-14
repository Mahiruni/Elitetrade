import { createAndroidReleaseService } from './android-release.mjs';
import {createSupportHandler,supportRoute} from './support.mjs';
import {marketDetails} from './market-view.mjs';
import { accountDetails } from './account-view.mjs';
import { renderBlogPage } from './blog.mjs';
import { createServer } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { digest, token, cookies } from './security.mjs';
import { createGateway, createTelegram } from './services.mjs';
import { createSupabaseData } from './supabase-data.mjs';
import { engineReady } from './demo-engine.mjs';
import { STRATEGIES,evaluateStrategy,planTrade } from './trading-strategies.mjs';
import { evaluatePoiStrategy } from './poi-strategy.mjs';
import {USDT_DESTINATION,usdtAmount} from './tron-payments.mjs';
import { EBOOK, sendEbook } from './ebook.mjs';
import QRCode from 'qrcode';

const now = () => Date.now();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message, code = '') => { const error=new HttpError(status, message);error.code=code;throw error; };
const string = (value, label, min = 1, max = 300) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label} must be ${min}â€“${max} characters.`);
  return value.trim();
};
const emailValue = (value) => {
  const e¶»§q«^