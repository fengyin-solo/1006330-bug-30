<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患整改管理管理</h2>
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

import {
  downloadEntries,
  hazardStats,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  runWithRetry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('hazard')
const columns = ["隐患编号", "隐患部位", "隐患等级", "整改措施", "责任人员", "发现日期", "整改期限", "逾期标记", "整改状态"]
const actions = ["派发整改", "提交验收", "标记逾期"]
const statuses = ["待整改", "整改中", "已验收", "已逾期"]

// 筛选条件留在会话里：收窄到需要的那几条之后，再回来时定位不跑偏。
const FILTER_CACHE_KEY = 'urban-utility-tunnel:hazard-filters'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["隐患编号", "隐患部位", "隐患等级", "整改状态"]
const stats = ref([
  { label: '待整改隐患', value: 0 },
  { label: '整改中隐患', value: 0 },
  { label: '已逾期隐患', value: 0 },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function restoreFilters() {
  try {
    const raw = window.sessionStorage.getItem(FILTER_CACHE_KEY)
    if (raw) {
      filters.value = JSON.parse(raw) as Record<string, string>
    }
  } catch {
    filters.value = {}
  }
}

function rememberFilters() {
  try {
    window.sessionStorage.setItem(FILTER_CACHE_KEY, JSON.stringify(filters.value))
  } catch {
    // 会话存储不可用时只影响条件记忆，不影响查询本身
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '隐患记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const attempt = runWithRetry(() => applyAction(meta.key, Number(row.id), action), `隐患记录${action}`)
  if (!attempt.ok) {
    errorMessage.value = attempt.message
    return
  }
  if (!attempt.value.ok) {
    errorMessage.value = attempt.value.message
    return
  }
  reload()
}

function refreshStats() {
  const summary = hazardStats()
  stats.value = [
    { label: '待整改隐患', value: summary.waiting },
    { label: '整改中隐患', value: summary.rectifying },
    { label: '已逾期隐患', value: summary.overdue },
  ]
}

function reload() {
  errorMessage.value = ''
  rememberFilters()
  const attempt = runWithRetry(() => listEntries(meta.key, filters.value), '隐患整改管理列表读取')
  if (!attempt.ok) {
    errorMessage.value = attempt.message
    return
  }
  rows.value = attempt.value.items
  total.value = attempt.value.total
  refreshStats()
}

onMounted(() => {
  restoreFilters()
  reload()
})
</script>
