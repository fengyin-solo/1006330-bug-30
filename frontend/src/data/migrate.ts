import { isDateLike } from './dates'
import { HAZARD_KEY, migrateHazardRow } from './hazard'
import { MODULE_BY_KEY } from './modules'
import type { BackfillIssue, EntryRow } from './types'

// 存量数据拨正与待补清单。迁移幂等：每次读库、写库都会过一遍，重复执行结果不变。

// 设备模块的历史数据按投运日期回填：上次保养日缺失（或不是日期）时取投运日期。
const DEVICE_KEY = 'device'
const DEVICE_COMMISSION_FIELD = '投运日期'
const DEVICE_LAST_MAINTAIN_FIELD = '上次保养日'

function migrateDeviceRow(row: EntryRow): EntryRow {
  const next = { ...row }
  if (!isDateLike(next[DEVICE_LAST_MAINTAIN_FIELD]) && isDateLike(next[DEVICE_COMMISSION_FIELD])) {
    next[DEVICE_LAST_MAINTAIN_FIELD] = next[DEVICE_COMMISSION_FIELD]
  }
  return next
}

function migrateRow(moduleKey: string, row: EntryRow): EntryRow {
  // 各模块通用：记录自身的状态字段（fields 最后一项）以当前 status 为准回写，两处结论一致。
  const meta = MODULE_BY_KEY.get(moduleKey)
  const statusField = meta?.fields[meta.fields.length - 1]
  const synced: EntryRow = statusField ? { ...row, [statusField]: row.status } : { ...row }
  if (moduleKey === HAZARD_KEY) {
    return migrateHazardRow(synced)
  }
  if (moduleKey === DEVICE_KEY) {
    return migrateDeviceRow(synced)
  }
  return synced
}

export function migrateRows(all: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(all)) {
    next[key] = rows.map((row) => migrateRow(key, row))
  }
  return next
}

// 必填项与日期项：回填后仍缺失的集中列成一张待补清单。
const REQUIRED_FIELDS: Record<string, { code: string; fields: string[]; dateFields: string[] }> = {
  [HAZARD_KEY]: {
    code: '隐患编号',
    fields: ['隐患编号', '隐患部位', '隐患等级', '发现日期', '整改期限'],
    dateFields: ['发现日期', '整改期限'],
  },
  [DEVICE_KEY]: {
    code: '设备编号',
    fields: ['设备编号', '设备名称', '投运日期', '上次保养日'],
    dateFields: ['投运日期', '上次保养日'],
  },
}

export function collectMissing(all: Record<string, EntryRow[]>): BackfillIssue[] {
  const issues: BackfillIssue[] = []
  for (const [key, rule] of Object.entries(REQUIRED_FIELDS)) {
    const meta = MODULE_BY_KEY.get(key)
    for (const row of all[key] ?? []) {
      const missing = rule.fields.filter((field) => {
        const value = row[field]
        if (value === undefined || value === null || String(value).trim() === '') {
          return true
        }
        return rule.dateFields.includes(field) && !isDateLike(value)
      })
      if (missing.length > 0) {
        issues.push({
          module: meta?.name ?? key,
          code: String(row[rule.code] ?? `#${row.id}`),
          fields: missing,
        })
      }
    }
  }
  return issues
}
