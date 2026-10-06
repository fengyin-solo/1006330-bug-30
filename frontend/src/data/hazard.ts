import type { EntryRow } from './types'

// 隐患整改管理的领域口径：状态、逾期标记、逾期条数都从这里算。
// 列表、看板、导出共用这一份结果，不再各算各的。

export const HAZARD_KEY = 'hazard'

/** 闭环状态：验收通过即闭环，之后不再计入待处理与逾期。 */
export const HAZARD_CLOSED_STATUS = '已验收'
export const HAZARD_OVERDUE_STATUS = '已逾期'

/** 整改期限回填的时限规则：按隐患等级给发现日期加上对应天数。 */
const LEAD_DAYS: [string[], number][] = [
  [['特别重大', '重大'], 7],
  [['较大'], 15],
]
const DEFAULT_LEAD_DAYS = 30

export function todayString(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isDateString(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return todayString(date)
}

export function leadDaysFor(level: string): number {
  for (const [levels, days] of LEAD_DAYS) {
    if (levels.some((item) => level.includes(item))) {
      return days
    }
  }
  return DEFAULT_LEAD_DAYS
}

export function isHazardClosed(row: EntryRow): boolean {
  return String(row.status) === HAZARD_CLOSED_STATUS
}

/** 逾期判定（唯一口径）：未闭环，且已被标记逾期或整改期限早于今天。 */
export function isHazardOverdue(row: EntryRow, today: string = todayString()): boolean {
  if (isHazardClosed(row)) {
    return false
  }
  if (String(row.status) === HAZARD_OVERDUE_STATUS) {
    return true
  }
  const deadline = String(row['整改期限'] ?? '')
  return isDateString(deadline) && deadline < today
}

/**
 * 把一条隐患记录归一到当前口径：
 * - 整改状态字段跟着状态机走（两路取值不一致时，以流转状态为准回算）；
 * - 逾期标记按逾期判定重算，验收通过后不再残留；
 * - pending / abnormal 同步推导，看板与列表读到的必然是同一结果。
 * 隐患等级、隐患部位等业务字段原样保留。
 */
export function normalizeHazardRow(row: EntryRow, today: string = todayString()): EntryRow {
  const closed = isHazardClosed(row)
  const overdue = isHazardOverdue(row, today)
  return {
    ...row,
    pending: !closed,
    abnormal: overdue,
    逾期标记: overdue ? '是' : '否',
    整改状态: String(row.status),
  }
}

export function normalizeHazardRows(rows: EntryRow[], today: string = todayString()): EntryRow[] {
  return rows.map((row) => normalizeHazardRow(row, today))
}

/** 验收通过：整改期限按实际完成日（今天）收口，逾期标记随归一清掉。 */
export function acceptHazardRow(row: EntryRow, today: string = todayString()): EntryRow {
  return normalizeHazardRow({ ...row, 整改期限: today }, today)
}

/** 存量隐患回填：整改期限缺失时按发现日期 + 等级时限补上。 */
export function backfillHazardRow(row: EntryRow): EntryRow {
  const next = { ...row }
  const deadline = String(next['整改期限'] ?? '').trim()
  const found = String(next['发现日期'] ?? '').trim()
  if (!isDateString(deadline) && isDateString(found)) {
    next['整改期限'] = addDays(found, leadDaysFor(String(next['隐患等级'] ?? '')))
  }
  return next
}

/**
 * 存量数据拨正：先按发现日期回填，再归一。
 * 早年逾期但实际已闭环（已验收）的记录，归一时逾期标记清掉、按闭环收口。
 */
export function migrateHazardRows(rows: EntryRow[], today: string = todayString()): EntryRow[] {
  return rows.map((row) => normalizeHazardRow(backfillHazardRow(row), today))
}

/** 逾期条数：按隐患编号去重重算，同一编号重复出现只算一条，不做累加。 */
export function overdueHazardCount(rows: EntryRow[], today: string = todayString()): number {
  const seen = new Set<string>()
  let count = 0
  for (const row of rows) {
    if (!isHazardOverdue(row, today)) {
      continue
    }
    const code = String(row['隐患编号'] ?? row.id)
    if (seen.has(code)) {
      continue
    }
    seen.add(code)
    count += 1
  }
  return count
}
