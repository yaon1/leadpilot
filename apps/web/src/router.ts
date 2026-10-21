import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './session';
import InboxView from './views/InboxView.vue';
import KnowledgeView from './views/KnowledgeView.vue';
import LoginView from './views/LoginView.vue';
import TicketView from './views/TicketView.vue';
import DealsView from './views/DealsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'inbox', component: InboxView },
    { path: '/tickets/:id', name: 'ticket', component: TicketView, props: true },
    { path: '/knowledge', name: 'knowledge', component: KnowledgeView },
    { path: '/deals', name: 'deals', component: DealsView },
    { path: '/login', name: 'login', component: LoginView },
  ],
});

router.beforeEach(async (to) => {
  const { session, me, login, logout } = useSession();
  if (to.name === 'login') return true;
  if (!session.value) return { name: 'login' };
  if (!me.value) {
    try {
      await login(session.value);
    } catch {
      logout();
      return { name: 'login' };
    }
  }
  return true;
});
