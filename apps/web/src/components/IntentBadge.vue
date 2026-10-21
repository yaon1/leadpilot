<script setup lang="ts">
import type { Intent, Urgency } from '@leadpilot/shared';
import { INTENT_LABELS } from '../format';

defineProps<{ intent: Intent | null | undefined; urgency?: Urgency | null }>();
</script>

<template>
  <span v-if="intent" class="inline-flex items-center gap-1 text-xs font-medium">
    <span class="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{{ INTENT_LABELS[intent] }}</span>
    <span v-if="urgency === 'high'" class="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 dark:bg-rose-950 dark:text-rose-300">срочно</span>
  </span>
  <span v-else class="text-xs text-slate-400">—</span>
</template>
