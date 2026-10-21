<script setup lang="ts">
import type { KbSource } from '@leadpilot/shared';
import { onMounted, ref } from 'vue';
import { useSession } from '../session';

const { api, isAdmin } = useSession();
const docs = ref<{ id: string; title: string; chunks: number; createdAt: string }[]>([]);
const query = ref('');
const results = ref<KbSource[]>([]);
const title = ref('');
const content = ref('');
const busy = ref(false);
const error = ref('');

async function load() {
  docs.value = (await api.value!.documents()).items;
}

async function search() {
  results.value = (await api.value!.search(query.value)).items;
}

async function add() {
  busy.value = true;
  error.value = '';
  try {
    await api.value!.addDocument(title.value, content.value);
    title.value = '';
    content.value = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function remove(id: string) {
  await api.value!.deleteDocument(id);
  await load();
}

onMounted(load);
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-2">
    <section class="space-y-4">
      <div class="card">
        <h1 class="mb-3 text-lg font-semibold">Документы</h1>
        <ul class="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          <li v-for="d in docs" :key="d.id" class="flex items-center gap-2 py-2">
            <span class="flex-1">{{ d.title }}</span>
            <span class="text-xs text-slate-500">{{ d.chunks }} фрагм.</span>
            <button v-if="isAdmin" type="button" class="text-xs text-rose-600 hover:underline" @click="remove(d.id)">Удалить</button>
          </li>
        </ul>
      </div>
      <form v-if="isAdmin" method="post" class="card space-y-3" @submit.prevent="add">
        <h2 class="font-semibold">Добавить документ</h2>
        <div>
          <label for="kb-title" class="label">Заголовок</label>
          <input id="kb-title" v-model="title" name="title" class="field" required maxlength="200" />
        </div>
        <div>
          <label for="kb-content" class="label">Текст</label>
          <textarea id="kb-content" v-model="content" name="content" class="field" rows="8" required />
        </div>
        <p class="min-h-5 text-sm text-rose-600" aria-live="polite">{{ error }}</p>
        <button type="submit" class="btn-primary" :disabled="busy">Сохранить и проиндексировать</button>
      </form>
    </section>

    <section class="card h-fit">
      <h2 class="mb-3 font-semibold">Проверить поиск (RAG)</h2>
      <form method="get" role="search" class="mb-4 flex gap-2" @submit.prevent="search">
        <label for="kb-q" class="sr-only">Запрос</label>
        <input id="kb-q" v-model="query" name="q" type="search" class="field" required placeholder="Сколько стоит интеграция с amoCRM?" />
        <button type="submit" class="btn-primary">Найти</button>
      </form>
      <ol class="space-y-3 text-sm">
        <li v-for="r in results" :key="r.chunkId">
          <div class="flex justify-between font-medium">
            <span>{{ r.title }}</span><span class="text-xs text-slate-500">{{ r.score.toFixed(3) }}</span>
          </div>
          <p class="text-slate-600 dark:text-slate-400">{{ r.content }}</p>
        </li>
      </ol>
    </section>
  </div>
</template>
