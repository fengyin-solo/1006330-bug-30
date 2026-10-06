import { todayIso } from '@/data/dates'
import {
  HAZARD_ACCEPT_ACTION,
  HAZARD_KEY,
  closeoutHazard,
  countHazardStatus,
  hazardFlags,
} from '@/data/hazard'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { collectMissing } from '@/data/migrate'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ActionResult, BackfillIssue, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 超时或断线允许重试一次；再失败就把原因写清楚抛给页面。
function withRetryOnce<T>(operation: () => T, label: string): T {
  try {
    return operation()
  } catch {
    try {
      return operation()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`${label}失败（已重试一次）：${reason}`)
    }
  }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
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
  return withRetryOnce(() => {
    const matched = filterRows(listRows(key), filters)
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }, '列表读取')
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  try {
    return withRetryOnce(() => {
      const rows = listRows(key)
      const index = rows.findIndex((row) => Number(row.id) === id)
      if (index < 0) {
        return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
      }
      const current = String(rows[index].status)
      if (current === target) {
        // 幂等：同一记录重复同一动作只算一次，计数也不会再减一回。
        return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
      }
      // 记录自身的状态字段（fields 最后一项）与系统状态一起改写，两处结论一致。
      const statusField = meta.fields[meta.fields.length - 1]
      let updated: EntryRow = { ...rows[index], status: target, [statusField]: target }
      if (key === HAZARD_KEY) {
        updated =
          action === HAZARD_ACCEPT_ACTION
            ? closeoutHazard(updated, todayIso())
            : { ...updated, ...hazardFlags(target) }
      } else {
        const lastStatus = meta.statuses[meta.statuses.length - 1]
        updated.pending = target !== lastStatus
        updated.abnormal = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
      }
      const next = [...rows]
      next[index] = updated
      saveRows(key, next)
      return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
    }, `${meta.entity}${action}`)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `${meta.entity}${action}失败` }
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 状态计数与运营概览同一条口径：按当前状态重算，隐患的已逾期按隐患编号去重。
function countStatus(key: string, rows: EntryRow[], status: string): number {
  if (key === HAZARD_KEY) {
    return countHazardStatus(rows, status)
  }
  return rows.filter((row) => String(row.status) === status).length
}

export function exportEntries(
  key: string,
  filters: Record<string, string> = {},
): { filename: string; content: string } {
  return withRetryOnce(() => {
    const meta = moduleMeta(key)
    const rows = filterRows(listRows(key), filters)
    const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== '')
    const lines: string[] = []
    if (activeFilters.length > 0) {
      // 结果已收窄到筛选出的那几条，把条件写进文件头，往后再回来时定位不跑偏。
      lines.push(`# 筛选条件,${activeFilters.map(([field, value]) => `${field}=${value.trim()}`).join(';')}`)
    }
    lines.push(['编号', ...meta.fields, '当前状态'].join(','))
    for (const row of rows) {
      lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
    }
    const summary = meta.statuses.map((status) => `${status}=${countStatus(key, rows, status)}`).join(',')
    lines.push(`# 状态统计（与运营概览同口径）,${summary}`)
    return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
  }, '清单导出')
}

export function downloadEntries(key: string, filters: Record<string, string> = {}): void {
  const { filename, content } = exportEntries(key, filters)
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
  return withRetryOnce(() => {
    const rows = allRows()
    const modules = [...MODULE_BY_KEY.values()].map((meta) => {
      const entries = rows[meta.key] ?? []
      // 两路取值不一致时以记录当前状态为准回算：隐患模块直接按状态统计，其余模块沿用标志位。
      const pending =
        meta.key === HAZARD_KEY
          ? entries.filter((row) => hazardFlags(String(row.status)).pending).length
          : entries.filter((row) => row.pending).length
      const abnormal =
        meta.key === HAZARD_KEY
          ? countHazardStatus(entries, '已逾期')
          : entries.filter((row) => row.abnormal).length
      return { name: meta.name, created: entries.length, pending, abnormal }
    })
    const cards = [
      { label: '业务模块', value: modules.length },
      { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
      { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
      { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    ]
    return { cards, modules }
  }, '概览统计')
}

// 回填后仍缺字段的记录，集中成一张待补清单。
export function listBackfillIssues(): BackfillIssue[] {
  return withRetryOnce(() => collectMissing(allRows()), '待补清单读取')
}
