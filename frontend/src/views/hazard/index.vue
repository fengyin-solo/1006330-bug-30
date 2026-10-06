<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}</h2>
        <p class="page-desc">维护隐患记录，围绕隐患编号、隐患部位、隐患等级、整改措施做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记隐患记录</button>
        <button class="btn" type="button" @click="exportRows">导出隐患整改管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无隐患整改管理数据，可先登记隐患记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患整改管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { countHazardStatus } from '@/data/hazard'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('hazard')
const columns = ["隐患编号", "隐患部位", "隐患等级", "整改措施", "责任人员", "发现日期", "整改期限", "整改状态"]
const actions = ["派发整改", "提交验收", "标记逾期"]
const statuses = ["待整改", "整改中", "已验收", "已逾期"]

const route = useRoute()
const router = useRouter()

const rows = ref<EntryRow[]>([])
// 统计口径用全量数据，与运营概览、导出清单读同一份；表格里只放筛选后的那几条。
const moduleRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["隐患编号", "隐患部位", "隐患等级", "整改状态"]

const stats = computed(() => [
  { label: '待整改隐患', value: countHazardStatus(moduleRows.value, '待整改') },
  { label: '整改中隐患', value: countHazardStatus(moduleRows.value, '整改中') },
  { label: '已逾期隐患', value: countHazardStatus(moduleRows.value, '已逾期') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: countHazardStatus(moduleRows.value, status),
  })),
)

function activeFilters(): Record<string, string> {
  const query: Record<string, string> = {}
  for (const field of filterFields) {
    const value = (filters.value[field] ?? '').trim()
    if (value !== '') {
      query[field] = value
    }
  }
  return query
}

// 筛选条件同步进地址栏：往后再回来时定位不跑偏。
function syncQuery() {
  const next = activeFilters()
  const current = route.query
  const same =
    Object.keys(next).length === Object.keys(current).length &&
    Object.entries(next).every(([field, value]) => current[field] === value)
  if (!same) {
    void router.replace({ query: next })
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  try {
    downloadEntries(meta.key, filters.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患整改管理清单导出失败'
  }
}

function openCreate() {
  errorMessage.value = '隐患记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key)
    moduleRows.value = payload.items
    rows.value = filterRows(payload.items, filters.value)
    total.value = rows.value.length
    syncQuery()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患整改管理列表读取失败'
  }
}

onMounted(() => {
  // 从地址栏恢复上次的筛选条件。
  for (const field of filterFields) {
    const value = route.query[field]
    if (typeof value === 'string' && value !== '') {
      filters.value[field] = value
    }
  }
  reload()
})
</script>
