import en from '../../strings/en.json';
import he from '../../strings/he.json';
import { config, saveConfig } from '../config';

type Dict = Record<string, string>;

const DICTS: Record<'en' | 'he', Dict> = { en: en as Dict, he: he as Dict };

let current: 'en' | 'he' = config.lang;
const listeners = new Set<() => void>();

export function lang(): 'en' | 'he' {
  return current;
}

export function isRtl(): boolean {
  return current === 'he';
}

export function setLang(next: 'en' | 'he'): void {
  if (next === current) return;
  current = next;
  config.lang = next;
  saveConfig();
  applyDocumentLang();
  for (const fn of listeners) fn();
}

export function toggleLang(): void {
  setLang(current === 'en' ? 'he' : 'en');
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyDocumentLang(): void {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'he' ? 'rtl' : 'ltr';
  document.documentElement.dataset.lang = current;
}

/** Look up a string, substituting {placeholders}. Missing keys show as [key]. */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw = DICTS[current][key] ?? DICTS.en[key];
  if (raw === undefined) return `[${key}]`;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

/** Numbers stay left-to-right even inside Hebrew sentences. */
export function num(n: number): string {
  return `⁦${n}⁩`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const str = m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`;
  return `⁦${str}⁩`;
}
