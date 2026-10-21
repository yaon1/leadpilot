<script setup lang="ts">
import type { Stats, Ticket, TicketStatus } from '@leadpilot/shared';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import IntentBadge from '../components/IntentBadge.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { STATUS_LABELS, timeAgo } from '../format';
import { useSession } from '../session';

const { api } = useSession();
const tickets = ref<Ticket[]>([]);
const stats = ref<Stats | null>(null);
const filter = ref<TicketStatus | undefined>('awaiting_review');
const loading = ref(false);
const error = ref('');

const filters: (TicketStatus | undefined)[] = ['awaiting_review', 'received', 'synced', 'rejected', 'failed', undefined];

async function refresh() {
  if (!api.value) return;
  loading.value = true;
  try {
    const [list, s] = await Promise.all([api.value.tickets(filter.value), api.value.stats()]);
    tickets.value = list.items;
    stats.value = s;
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

// Test message form (simulates a website form submission)
const text = ref('');
const name = ref('');
const sending = ref(false);
async function send() {
  if (!api.value) return;
  sending.value = true;
  try {
    await api.value.submit(text.value, name.value ? { name: name.value } : {});
    text.value = '';
    name.value = '';
    filter.value = undefined;
    await refresh();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 4000);
});
onUnmounted(() => clearInterval(timer));
watch(filter, refresh);
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
    <section>
      <div class="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Фильтр по статусу">
        <button
          v-for="f in filters"
          :key="f ?? 'all'"
          type="button"
          role="tab"
          :aria-selected="filter === f"
          class="btn min-h-8 px-3 py-1"
          :class="filter === f ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700'"
          @click="filter = f"
        >
          {{ f ? STATUS_LABELS[f] : 'Все' }}
          <span v-if="f && stats?.byStatus[f]" class="rounded-full bg-black/10 px-1.5 text-xs">{{ stats.byStatus[f] }}</span>
        </button>
      </div>

      <p v-if="error" class="mb-3 text-sm text-rose-600" role="alert">{{ error }}</p>

      <ul class="space-y-2" :aria-busy="loading">
        <li v-for="t in tickets" :key="t.id">
          <RouterLink :to="`/tickets/${t.id}`" class="card block transition hover:border-indigo-300 hover:shadow">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <StatusBadge :status="t.status" />
              <IntentBadge :intent="t.extraction?.intent" :urgency="t.extraction?.urgency" />
              <span class="text-xs text-slate-500">{{ t.channel }} · {{ timeAgo(t.createdAt) }}</span>
              <span v-if="t.extraction?.customerName" class="ms-auto text-sm font-medium">{{ t.extraction.customerName }}</span>
            </div>
            <p class="line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{{ t.extraction?.summary ?? t.text }}</p>
          </RouterLink>
        </li>
        <li v-if="!tickets.length && !loading" class="card text-center text-sm text-slate-500">Здесь пока пусто</li>
      </ul>
    </section>

    <aside class="space-y-4">
      <section class="card" aria-labelledby="stats-h">
        <h2 id="stats-h" class="mb-2 font-semibold">Сводка</h2>
        <dl class="grid grid-cols-2 gap-2 text-sm">
          <dt class="text-slate-500">За 24 часа</dt>
          <dd class="text-end font-medium">{{ stats?.last24h ?? '—' }}</dd>
          <dt class="text-slate-500">Попыток LLM в среднем</dt>
          <dd class="text-end font-medium">{{ stats?.avgLlmAttempts ?? '—' }}</dd>
          <template v-for="(n, intent) in stats?.byIntent" :key="intent">
            <dt class="text-slate-500">{{ intent }}</dt>
            <dd class="text-end font-medium">{{ n }}</dd>
          </template>
        </dl>
      </section>

      <section class="card" aria-labelledby="test-h">
        <h2 id="test-h" class="mb-2 font-semibold">Тестовая заявка</h2>
        <form method="post" class="space-y-3" @submit.prevent="send">
          <div>
            <label for="t-name" class="label">Имя клиента</label>
            <input id="t-name" v-model="name" name="name" class="field" autocomplete="off" />
          </div>
          <div>
            <label for="t-text" class="label">Сообщение <span aria-hidden="true">*</span></label>
            <textarea id="t-text" v-model="text" name="text" class="field" rows="4" required maxlength="8000" placeholder="Сколько стоит интеграция с Битрикс24? Телефон 8 999 123-45-67" />
          </div>
          <button type="submit" class="btn-primary w-full" :disabled="sending">{{ sending ? 'Отправляем…' : 'Отправить как с сайта' }}</button>
        </form>
      </section>
    </aside>
  </div>
</template>
