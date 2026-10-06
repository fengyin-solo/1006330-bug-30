import {
  HAZARD_KEY,
  acceptHazardRow,
  normalizeHazardRows,
  overdueHazardCount,
} from '@/data/hazard'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  MissingItem,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 关键日期类字段：缺失的记录集中列成待补清单，补齐前一直挂在上面。
const REQUIRED_FIELD_SUFFIXES = ['日期', '期限', '日']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 读取口径的唯一入口：隐患模块每次读出都先归一（逾期标记、整改状态、pending 重算），
// 列表、看板、导出走的是同一个入口，三处读到的必然是同一条口径。
function readRows(key: string): EntryRow[] {
  const rows = listRows(key)
  return key === HAZARD_KEY ? normalizeHazardRows(rows) : rows
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(readRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = readRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    // 幂等：同一记录反复执行同一动作只算一次，逾期计数不会被重复扣减。
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  let updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === HAZARD_KEY && action === '提交验收') {
    // 验收通过：清掉逾期标记、整改期限按实际完成日收口，隐患等级与隐患部位原样保留。
    updated = acceptHazardRow({ ...updated, status: target })
  }
  const next = [...rows]
  next[index] = updated
  // 隐患模块落库前整体归一，保证存进去的就是口径内的结果。
  saveRows(key, key === HAZARD_KEY ? normalizeHazardRows(next) : next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of readRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const raw = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries =
      meta.key === HAZARD_KEY ? normalizeHazardRows(raw[meta.key] ?? []) : (raw[meta.key] ?? [])
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

export type HazardStats = {
  waiting: number
  rectifying: number
  overdue: number
}

// 隐患页统计卡：与列表、看板、导出同一份归一数据，逾期条数按隐患编号去重重算。
export function hazardStats(): HazardStats {
  const rows = readRows(HAZARD_KEY)
  return {
    waiting: rows.filter((row) => String(row.status) === '待整改').length,
    rectifying: rows.filter((row) => String(row.status) === '整改中').length,
    overdue: overdueHazardCount(rows),
  }
}

// 缺失关键日期字段的记录集中列一张待补清单，各模块共用这一份。
export function listMissingItems(): MissingItem[] {
  const items: MissingItem[] = []
  for (const meta of MODULE_BY_KEY.values()) {
    const required = meta.fields.filter((field) =>
      REQUIRED_FIELD_SUFFIXES.some((suffix) => field.endsWith(suffix)),
    )
    if (required.length === 0) {
      continue
    }
    for (const row of readRows(meta.key)) {
      const missing = required.filter((field) => String(row[field] ?? '').trim() === '')
      if (missing.length > 0) {
        items.push({
          module: meta.name,
          id: Number(row.id),
          label: String(row[meta.fields[0]] ?? row.id),
          fields: missing,
        })
      }
    }
  }
  return items
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string }

// 超时或断线允许重试一次；再失败就把原因写清楚交还给页面展示。
export function runWithRetry<T>(op: () => T, describe: string): Attempt<T> {
  let reason = '未知原因'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { ok: true, value: op() }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
  }
  return { ok: false, message: `${describe}失败（已自动重试一次）：${reason}` }
}
