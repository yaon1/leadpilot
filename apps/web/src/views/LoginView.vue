<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../session';

const { login } = useSession();
const router = useRouter();
const apiUrl = ref('/api');
const apiKey = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await login({ apiUrl: apiUrl.value, apiKey: apiKey.value.trim() });
    router.push('/');
  } catch (e) {
    error.value = (e as Error).message || 'Не удалось войти';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card mx-auto mt-10 max-w-md">
    <h1 class="mb-1 text-xl font-semibold">Вход оператора</h1>
    <p class="mb-4 text-sm text-slate-500">Используйте API-ключ с ролью operator или admin. В демо он задан в <code>.env</code> (DEMO_OPERATOR_KEY).</p>
    <form method="post" class="space-y-4" @submit.prevent="submit">
      <div>
        <label for="api-url" class="label">Адрес API</label>
        <input id="api-url" v-model="apiUrl" name="apiUrl" class="field" required autocomplete="url" spellcheck="false" autocapitalize="off" />
      </div>
      <div>
        <label for="api-key" class="label">API-ключ</label>
        <input
          id="api-key"
          v-model="apiKey"
          name="apiKey"
          type="password"
          class="field"
          required
          minlength="8"
          autocomplete="current-password"
          spellcheck="false"
          autocapitalize="off"
          aria-describedby="login-error"
        />
      </div>
      <p id="login-error" class="min-h-5 text-sm text-rose-600" aria-live="polite">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="busy">{{ busy ? 'Проверяем…' : 'Войти' }}</button>
    </form>
  </section>
</template>
