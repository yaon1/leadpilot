<script setup lang="ts">
import type { Extraction, Intent, Urgency } from '@leadpilot/shared';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { TicketDetail } from '../api';
import IntentBadge from '../components/IntentBadge.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { INTENT_LABELS, URGENCY_LABELS, formatRub, timeAgo } from '../format';
import { useSession } from '../session';

const props = defineProps<{ id: string }>();
const { api, canReview } = useSession();

const ticket = ref<TicketDetail | null>(null);
const reply = ref('');
const fields = ref<Partial<Extraction>>({});
const rejectReason = ref('');
const busy = ref(false);
const error = ref('');
const rejectDialog = ref<HTMLDialogElement | null>(null);

const reviewable = computed(() => ticket.value?.status === 'awaiting_review' && canReview.value);

async function load() {
  if (!api.value) return;
  try {
    const t = await api.value.ticket(props.id);
    const first = !ticket.value || ticket.value.status !== t.status;
    ticket.value = t;
    if (first) {
      reply.value = t.draft?.reply ?? '';
      fields.value = { ...t.extraction };
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function act(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function approve() {
  const x = ticket.value?.extraction;
  const changed = Object.fromEntries(Object.entries(fields.value).filter(([k, v]) => x && x[k as keyof Extraction] !== v)) as Partial<Extraction>;
  return act(() => api.value!.approve(props.id, { reply: reply.value, ...(Object.keys(changed).length ? { extraction: changed } : {}) }));
}

function reject() {
  rejectDialog.value?.close();
  return act(() => api.value!.reject(props.id, rejectReason.value));
}

const intents = Object.keys(INTENT_LABELS) as Intent[];
const urgencies = Object.keys(URGENCY_LABELS) as Urgency[];

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  load();
  timer = setInterval(() => {
    if (ticket.value && ['received', 'approved'].includes(ticket.value.status)) load();
  }, 1500);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <RouterLink to="/" class="mb-4 inline-block text-sm text-indigo-600 hover:underline">← Ко входящим</RouterLink>
  <p v-if="error" class="mb-3 text-sm text-rose-600" role="alert">{{ error }}</p>

  <div v-if="ticket" class="grid gap-6 lg:grid-cols-[1fr_340px]">
    <div class="space-y-4">
      <section class="card">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge :status="ticket.status" />
          <IntentBadge :intent="ticket.extraction?.intent" :urgency="ticket.extraction?.urgency" />
          <span class="text-xs text-slate-500">{{ ticket.channel }} · {{ timeAgo(ticket.createdAt) }}</span>
        </div>
        <h1 class="mb-2 text-lg font-semibold">{{ ticket.extraction?.summary ?? 'Обращение' }}</h1>
        <blockquote class="rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap dark:bg-slate-800">{{ ticket.text }}</blockquote>
        <p v-if="ticket.error" class="mt-2 text-sm text-rose-600">{{ ticket.error }}</p>
      </section>

      <section v-if="ticket.status === 'received'" class="card text-sm text-slate-500" aria-live="polite">AI разбирает сообщение…</section>

      <section v-if="ticket.draft || ticket.finalReply" class="card">
        <h2 class="mb-2 font-semibold">Ответ клиенту</h2>
        <p v-if="ticket.draft?.needsHuman" class="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          В базе знаний нет ответа — AI подготовил вежливую заглушку. Дополните ответ.
        </p>
        <form v-if="reviewable" method="post" @submit.prevent="approve">
          <label for="reply" class="label">Черновик AI (можно отредактировать)</label>
          <textarea id="reply" v-model="reply" name="reply" class="field mb-3" rows="6" required maxlength="4000" />
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary" :disabled="busy">Одобрить и отправить в CRM</button>
            <button type="button" class="btn-secondary" :disabled="busy" @click="rejectDialog?.showModal()">Отклонить</button>
          </div>
        </form>
        <p v-else class="text-sm whitespace-pre-wrap">{{ ticket.finalReply ?? ticket.draft?.reply }}</p>
      </section>

      <section v-if="ticket.sources.length" class="card">
        <h2 class="mb-2 font-semibold">Источники из базы знаний</h2>
        <ol class="space-y-2 text-sm">
          <li v-for="s in ticket.sources" :key="s.chunkId" :class="ticket.draft?.sourceIds.includes(s.id) ? '' : 'opacity-60'">
            <span class="font-medium">[{{ s.id }}] {{ s.title }}</span>
            <span class="ms-2 text-xs text-slate-500">score {{ s.score.toFixed(2) }}</span>
            <span v-if="ticket.draft?.sourceIds.includes(s.id)" class="ms-2 text-xs text-emerald-600">использован</span>
            <p class="text-slate-600 dark:text-slate-400">{{ s.content }}</p>
          </li>
        </ol>
      </section>
    </div>

    <aside class="space-y-4">
      <section class="card">
        <h2 class="mb-2 font-semibold">Поля для CRM</h2>
        <form v-if="reviewable" class="space-y-2 text-sm" @submit.prevent>
          <div>
            <label for="f-intent" class="label">Тип</label>
            <select id="f-intent" v-model="fields.intent" name="intent" class="field">
              <option v-for="i in intents" :key="i" :value="i">{{ INTENT_LABELS[i] }}</option>
            </select>
          </div>
          <div>
            <label for="f-name" class="label">Имя</label>
            <input id="f-name" v-model="fields.customerName" name="customerName" class="field" autocomplete="off" />
          </div>
          <div>
            <label for="f-phone" class="label">Телефон (E.164)</label>
            <input id="f-phone" v-model="fields.phone" name="phone" type="tel" class="field" pattern="\+\d{10,15}" autocomplete="off" />
          </div>
          <div>
            <label for="f-email" class="label">Email</label>
            <input id="f-email" v-model="fields.email" name="email" type="email" class="field" autocomplete="off" spellcheck="false" />
          </div>
          <div>
            <label for="f-product" class="label">Продукт</label>
            <input id="f-product" v-model="fields.product" name="product" class="field" autocomplete="off" />
          </div>
          <div>
            <label for="f-urgency" class="label">Срочность</label>
            <select id="f-urgency" v-model="fields.urgency" name="urgency" class="field">
              <option v-for="u in urgencies" :key="u" :value="u">{{ URGENCY_LABELS[u] }}</option>
            </select>
          </div>
        </form>
        <dl v-else-if="ticket.extraction" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt class="text-slate-500">Имя</dt>
          <dd>{{ ticket.extraction.customerName ?? '—' }}</dd>
          <dt class="text-slate-500">Телефон</dt>
          <dd>{{ ticket.extraction.phone ?? '—' }}</dd>
          <dt class="text-slate-500">Email</dt>
          <dd>{{ ticket.extraction.email ?? '—' }}</dd>
          <dt class="text-slate-500">Продукт</dt>
          <dd>{{ ticket.extraction.product ?? '—' }}</dd>
          <dt class="text-slate-500">Бюджет</dt>
          <dd>{{ formatRub(ticket.extraction.budgetRub) }}</dd>
          <dt class="text-slate-500">Уверенность</dt>
          <dd>{{ Math.round(ticket.extraction.confidence * 100) }}%</dd>
        </dl>
        <p v-if="ticket.crmDealId" class="mt-3 text-sm">Сделка в CRM: <strong>#{{ ticket.crmDealId }}</strong></p>
        <button v-if="ticket.status === 'failed' && canReview" type="button" class="btn-secondary mt-3 w-full" :disabled="busy" @click="act(() => api!.retry(id))">
          Повторить
        </button>
      </section>

      <section class="card">
        <h2 class="mb-2 font-semibold">История</h2>
        <ol class="space-y-1 text-xs text-slate-600 dark:text-slate-400">
          <li v-for="e in ticket.events" :key="e.id">{{ timeAgo(e.createdAt) }} — {{ e.type }} <span class="text-slate-400">({{ e.actor }})</span></li>
          <li>LLM-попыток: {{ ticket.llmAttempts }}</li>
        </ol>
      </section>
    </aside>

    <dialog ref="rejectDialog" class="m-auto w-full max-w-md rounded-xl p-0 backdrop:bg-black/40 dark:bg-slate-900 dark:text-slate-100" aria-labelledby="reject-h">
      <form method="dialog" class="space-y-3 p-5" @submit.prevent="reject">
        <h2 id="reject-h" class="font-semibold">Отклонить обращение</h2>
        <label for="reject-reason" class="label">Причина</label>
        <input id="reject-reason" v-model="rejectReason" name="reason" class="field" required maxlength="500" placeholder="Спам, дубль, тест…" />
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" @click="rejectDialog?.close()">Отмена</button>
          <button type="submit" class="btn-danger" :disabled="busy">Отклонить</button>
        </div>
      </form>
    </dialog>
  </div>
</template>
