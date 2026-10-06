import { isDateLike } from './dates'
import type { EntryRow } from './types'

// 隐患模块的统一口径：列表、页内统计、运营概览、导出清单都从这里取数，选定后不再各写一套。
// 事实来源只有一条——记录当前的 status；状态字段、pending/abnormal 标志、统计数全部由它回算。
export const HAZARD_KEY = 'hazard'
export const HAZARD_CODE_FIELD = '隐患编号'
export const HAZARD_STATUS_FIELD = '整改状态'
export const HAZARD_DEADLINE_FIELD = '整改期限'
export const HAZARD_FOUND_FIELD = '发现日期'
export const HAZARD_ACCEPT_ACTION = '提交验收'
export const HAZARD_CLOSED_STATUS = '已验收'
export const HAZARD_OVERDUE_STATUS = '已逾期'
export const HAZARD_OPEN_STATUSES = ['待整改', '整改中']

// 逾期条数按隐患编号去重重算，不累加；同一隐患反复验收也只算一次。
export function countOverdueHazards(rows: EntryRow[]): number {
  const codes = new Set<string>()
  for (const row of rows) {
    if (String(row.status) === HAZARD_OVERDUE_STATUS) {
      codes.add(String(row[HAZARD_CODE_FIELD] ?? row.id))
    }
  }
  return codes.size
}

export function countHazardStatus(rows: EntryRow[], status: string): number {
  if (status === HAZARD_OVERDUE_STATUS) {
    return countOverdueHazards(rows)
  }
  return rows.filter((row) => String(row.status) === status).length
}

// 标志位由状态回算：待整改/整改中算待处理，已逾期算异常，已验收两头都不占。
export function hazardFlags(status: string): { pending: boolean; abnormal: boolean } {
  return {
    pending: HAZARD_OPEN_STATUSES.includes(status),
    abnormal: status === HAZARD_OVERDUE_STATUS,
  }
}

// 验收通过收口：清掉逾期标记（整改状态同步、异常标志清除），整改期限按实际完成日收口；
// 隐患等级、隐患部位等其余字段原样保留。
export function closeoutHazard(row: EntryRow, today: string): EntryRow {
  return {
    ...row,
    status: HAZARD_CLOSED_STATUS,
    [HAZARD_STATUS_FIELD]: HAZARD_CLOSED_STATUS,
    [HAZARD_DEADLINE_FIELD]: today,
    ...hazardFlags(HAZARD_CLOSED_STATUS),
  }
}

// 存量拨正（幂等）：
// 1. 整改状态字段以当前 status 为准回写，清掉残留的逾期标记与占位文本；
// 2. 整改期限缺失时按发现日期回填；
// 3. 早年逾期但实际已闭环（已验收而期限早于发现日）的记录，期限拨正到发现日收口。
export function migrateHazardRow(row: EntryRow): EntryRow {
  const status = String(row.status)
  const next: EntryRow = {
    ...row,
    [HAZARD_STATUS_FIELD]: status,
    ...hazardFlags(status),
  }
  const found = row[HAZARD_FOUND_FIELD]
  const deadline = row[HAZARD_DEADLINE_FIELD]
  if (!isDateLike(deadline)) {
    if (isDateLike(found)) {
      next[HAZARD_DEADLINE_FIELD] = String(found)
    }
  } else if (status === HAZARD_CLOSED_STATUS && isDateLike(found) && String(deadline) < String(found)) {
    next[HAZARD_DEADLINE_FIELD] = String(found)
  }
  return next
}
