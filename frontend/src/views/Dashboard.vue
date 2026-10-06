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

    <header class="page-head">
      <div>
        <h2>待补清单</h2>
        <p class="page-desc">关键日期字段缺失的记录集中列在这里，补齐后自动移出。</p>
      </div>
    </header>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>记录编号</th><th>缺失字段</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in missingItems" :key="`${item.module}-${item.id}`">
          <td>{{ item.module }}</td>
          <td>{{ item.label }}</td>
          <td>{{ item.fields.join('、') }}</td>
        </tr>
        <tr v-if="!missingItems.length">
          <td colspan="3" class="empty-state">暂无待补项，关键日期字段均已回填</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { listMissingItems, loadOverview } from '@/api/local-service'
import type { MissingItem, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const missingItems = ref<MissingItem[]>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  missingItems.value = listMissingItems()
}

onMounted(refresh)
</script>
