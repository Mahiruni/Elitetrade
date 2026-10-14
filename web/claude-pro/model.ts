export type DataMode = 'demo' | 'mt5';
export type Direction = 'higher' | 'lower' | 'none';
export type Preset = 'sonnet' | 'opus' | 'fable';
export type Market = 'OTC' | 'Stock';
export interface Preferences { mode: DataMode; asset: string; duration: number; preset: Preset; market: Market; botId: string }
export interface Reading { title: string; detail: string; tone?: 'up' | 'down'; available: boolean }
export interface SignalResult { id: string; instrument: string; direction: Direction; mode: DataMode; duration: number; preset: Preset; generatedAt: number; expiresAt: number; readings: Reading[]; note: string; timeframe?: string; poi?: PoiPreview }
export interface Bot { id: string; name: string; symbol: string; strategy: string; status: string; account_id?: string; risk_percent?: number; lot_size?: number; engineMessage?: string }
export interface Account { id: string; broker: string; login: string; status: string }
export interface User { id?: string; name?: string; email?: string; active?: boolean; role?: string }
export interface Api { <T>(path: string, method?: string, body?: object): Promise<T> }
export interface Host { api: Api; user: User; config: { connectionMode?: string }; standalone?: boolean }
export interface PoiPreview {
  version: string; source: string; symbol: string; state: 'BUY' | 'SELL' | 'WAIT'; validated: boolean; executionEnabled: false;
  bid: number; ask: number; spread: number; quoteTime: string; reasons: string[];
  w1: { bias: string; closedAt: ¶»§q«^