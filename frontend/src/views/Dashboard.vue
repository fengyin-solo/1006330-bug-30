<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section class="backfill-panel">
      <h3>待补清单</h3>
      <p v-if="!backfillIssues.length" class="backfill-empty">
        暂无缺失项：存量隐患已按发现日期回填，历史设备数据已按投运日期回填。
      </p>
      <template v-else>
        <p class="backfill-empty">以下记录回填后仍缺字段，请补齐后再核对统计口径。</p>
        <table class="data-table">
          <thead>
            <tr><th>业务模块</th><th>记录编号</th><th>缺失字段</th></tr>
          </thead>
          <tbody>
            <tr v-for="issue in backfillIssues" :key="`${issue.module}-${issue.code}`">
              <td>{{ issue.module }}</td>
              <td>{{ issue.code }}</td>
              <td>{{ issue.fields.join('、') }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listBackfillIssues, loadOverview } from '@/api/local-service'
import type { BackfillIssue, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const backfillIssues = ref<BackfillIssue[]>([])
const errorMessage = ref('')

function refresh() {
  errorMessage.value = ''
  try {
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
    backfillIssues.value = listBackfillIssues()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '运营概览统计失败'
  }
}

onMounted(refresh)
</script>

<style scoped>
.backfill-panel {
  margin-top: 16px;
}
.backfill-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.backfill-empty {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 8px;
}
</style>
