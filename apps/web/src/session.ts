import { computed, ref } from 'vue';
import { createApi, loadSession, saveSession, type Me, type Session } from './api';

const session = ref<Session | null>(loadSession());
const me = ref<Me | null>(null);

export function useSession() {
  const api = computed(() => (session.value ? createApi(session.value) : null));
  return {
    session,
    me,
    api,
    canReview: computed(() => me.value?.role === 'admin' || me.value?.role === 'operator'),
    isAdmin: computed(() => me.value?.role === 'admin'),
    async login(s: Session) {
      const profile = await createApi(s).me();
      session.value = s;
      me.value = profile;
      saveSession(s);
    },
    logout() {
      session.value = null;
      me.value = null;
      saveSession(null);
    },
  };
}
