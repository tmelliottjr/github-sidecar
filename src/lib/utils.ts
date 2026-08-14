import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const UNITS: Array<[limit: number, divisor: number, suffix: string]> = [
  [60, 1, 's'],
  [3600, 60, 'm'],
  [86_400, 3600, 'h'],
  [2_592_000, 86_400, 'd'],
  [31_536_000, 2_592_000, 'mo'],
]

/** Compact relative time, e.g. `4h`, tuned for dense list rows. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 45) return 'now'
  for (const [limit, divisor, suffix] of UNITS) {
    if (seconds < limit) return `${Math.round(seconds / divisor)}${suffix}`
  }
  return `${Math.round(seconds / 31_536_000)}y`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
