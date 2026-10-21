<script setup lang="ts">
import type { CrmDeal } from '@leadpilot/shared';
import { onMounted, ref } from 'vue';
import { formatRub, timeAgo } from '../format';
import { useSession } from '../session';

const { api } = useSession();
const deals = ref<CrmDeal[]>([]);
const adapter = ref('');
const q = ref('');

async function load() {
  const res = await api.value!.deals(q.value);
  deals.value = res.items;
  adapter.value = res.adapter;
}
onMounted(load);
</script>

<template>
  <section class="card">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="text-lg font-semibold">Сделки в CRM</h1>
      <span class="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">адаптер: {{ adapter }}</span>
      <form method="get" role="search" class="ms-auto flex gap-2" @submit.prevent="load">
        <label for="deal-q" class="sr-only">Поиск</label>
        <input id="deal-q" v-model="q" name="q" type="search" class="field" placeholder="Название, имя, телефон" />
        <button type="submit" class="btn-secondary">Найти</button>
      </form>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="text-xs text-slate-500 uppercase">
          <tr>
            <th scope="col" class="py-2">#</th>
            <th scope="col">Название</th>
            <th scope="col">Контакт</th>
            <th scope="col">Сумма</th>
            <th scope="col">Создана</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr v-for="d in deals" :key="d.id">
            <td class="py-2">{{ d.id }}</td>
            <td>{{ d.title }}</td>
            <td>{{ [d.contactName, d.phone, d.email].filter(Boolean).join(', ') || '—' }}</td>
            <td>{{ formatRub(d.amountRub) }}</td>
            <td>{{ timeAgo(d.createdAt) }}</td>
          </tr>
          <tr v-if="!deals.length">
            <td colspan="5" class="py-6 text-center text-slate-500">Сделок пока нет — одобрите обращение во «Входящих»</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
