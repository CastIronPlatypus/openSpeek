import type { SourceKind } from '../types';

/** Typical speaking pace of the voices at 1×, used for listening-time estimates. */
const WORDS_PER_MINUTE = 160;

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatListeningTime(wordCount: number, rate: number): string {
  return formatMinutes(Math.round(wordCount / WORDS_PER_MINUTE / rate));
}

/** A listening time in seconds, rounded to minutes ("< 1 min", "12 min", "1 h 5 min"). */
export function formatDuration(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60));
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

const numberFormat = new Intl.NumberFormat();
export function formatCount(n: number, unit: string): string {
  return `${numberFormat.format(n)} ${unit}${n === 1 ? '' : 's'}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];
export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = (timestamp - now) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  text: 'Text',
  pdf: 'PDF',
  epub: 'EPUB',
  docx: 'Word',
  html: 'HTML',
  web: 'Web page',
  markdown: 'Markdown',
};

export function fileSafeName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || 'openSpeek';
}
