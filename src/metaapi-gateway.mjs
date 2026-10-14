import { createHash } from 'node:crypto';
const provisioning = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const error = (message, status = 503) => Object.assign(new Error(message), { status });
const nameFor = id => `EliteTrade ${id}`;
const providerErrors = new Map([
  ['E_SRV_NOT_FOUND', 'MetaApi could not find this broker server for MT5. Copy the exact MT5 server from your broker account details. If it is correct, configure a provisioning profile in MetaApi.'],
  ['E_AUTH', 'The broker rejected the MT5 login. Confirm this is an MT5 account, its exact assigned server, and its trading or investor password.'],
  ['E_SERVER_TIMEZONE', 'MetaApi could not detect the broker settings. Retry later or configure a provisioning profile in MetaApi.'],
  ['E_RESOURCE_SLOTS', 'This account needs more MetaApi resource slots. Review the required capacity and cost in MetaApi before connecting.'],
  ['E_NO_SYMBOLS', 'The broker account has no configured trading symbols. Check the account with your broker.'],
  ['ERR_OTP_REQUIRED', 'This broker account requires a one-time password that MetaApi cannot use. Review the account authentication settings with your broker.'],
  ['E_PASSWORD_CHANGE_REQUIRED', 'The broker requires a trading-account password change. Change it with your broker, then update the saved account details.'],
  ['E_TRADING_ACCOUNT_DISABLED', 'The broker reports this trading account is disabled. Contact the broker o¶»§q«^