import { migrateHazardRows } from './hazard'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 存量数据拨正：隐患按发现日期回填并归一（早年逾期但已闭环的随归一收口）；
// 设备历史数据按投运日期回填上次保养日，仍缺的关键字段由待补清单集中列出。
function migrateStored(map: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next = { ...map }
  if (Array.isArray(next.hazard)) {
    next.hazard = migrateHazardRows(next.hazard)
  }
  if (Array.isArray(next.device)) {
    next.device = next.device.map((row) => {
      const lastMaintenance = String(row['上次保养日'] ?? '').trim()
      const commissioned = String(row['投运日期'] ?? '').trim()
      return lastMaintenance === '' && commissioned !== ''
        ? { ...row, 上次保养日: commissioned }
        : row
    })
  }
  return next
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = migrateStored(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = migrateStored({ ...fallback, ...parsed })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
