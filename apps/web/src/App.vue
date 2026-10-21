<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useSession } from './session';

const { me, logout } = useSession();
const router = useRouter();

function signOut() {
  logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <header class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
    <nav class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" aria-label="Main">
      <RouterLink to="/" class="text-lg font-semibold text-indigo-600 dark:text-indigo-400">LeadPilot</RouterLink>
      <template v-if="me">
        <RouterLink to="/" class="text-sm hover:underline" active-class="font-semibold">Входящие</RouterLink>
        <RouterLink to="/deals" class="text-sm hover:underline" active-class="font-semibold">Сделки CRM</RouterLink>
        <RouterLink to="/knowledge" class="text-sm hover:underline" active-class="font-semibold">База знаний</RouterLink>
        <span class="ms-auto text-sm text-slate-500">{{ me.tenant }} · {{ me.name }} ({{ me.role }})</span>
        <button type="button" class="btn-secondary" @click="signOut">Выйти</button>
      </template>
    </nav>
  </header>
  <main class="mx-auto max-w-6xl px-4 py-6">
    <RouterView />
  </main>
</template>
