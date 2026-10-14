import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArrowDownRight, ArrowUpRight, Bot as BotIcon, Check, ChevronDown, ChevronRight, Clock3, Crown, ExternalLink, Gem, Globe2, LoaderCircle, MoreHorizontal, Pause, Play, RotateCcw, Search, ShieldCheck, Sparkles, Sun, UserRound, X, Zap } from 'lucide-react';
import { ASSETS, DEFAULTS, DURATIONS, PRESETS, brokerSignal, countdown, cycleDelay, demoSignal, durationLabel, durationWords, formatCountdown, readingTitles, restorePreferences, type Account, type Api, type Bot, type Host, type Preferences, type Preset, type Preview, type Reading, type SignalResult } from './model';

type Flow = { stage: 'config' } | { stage: 'analyzing'; completed: number; startedAt: number } | { stage: 'result'; signal: SignalResult } | { stage: 'error'; message: string };
type SheetName = 'assets' | 'broker' | 'help' | 'language' | 'worker' | null;
const PREF_KEY = 'elite-claude-pro-preferences';
const loadPreferences = () => { try { return restorePreferences(localStorage.getItem(PREF_KEY)); } catch { return { ...DEFAULTS }; } };

function CurrencyFlag({ code }: { code: string }) {
  const clip = useId();
  const flag = code === 'EUR' ? <><rect width="24" height="24" fill="#2057ae" />{Array.from({ length: 12 }, (_, index) => <circle key={index} cx={12 + Math.cos(index * Math.PI / 6) * 6} cy={12 + Math.sin(index * Math.PI / 6) * 6} r=".8" fill="#f6d055" />¶»§q«^