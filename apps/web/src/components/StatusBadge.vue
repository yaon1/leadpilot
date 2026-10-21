<script setup lang="ts">
import type { TicketStatus } from '@leadpilot/shared';
import { STATUS_CLASSES, STATUS_LABELS } from '../format';

defineProps<{ status: TicketStatus }>();
</script>

<template>
  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" :class="STATUS_CLASSES[status]">
    {{ STATUS_LABELS[status] }}
  </span>
</template>
