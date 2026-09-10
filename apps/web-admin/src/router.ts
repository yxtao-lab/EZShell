import { createRouter, createWebHistory } from "vue-router";
import LoginView from "./views/LoginView.vue";
import DashboardView from "./views/DashboardView.vue";
import { getTokens } from "./lib/auth-store";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    { path: "/", name: "dashboard", component: DashboardView },
  ],
});

router.beforeEach((to) => {
  if (to.name !== "login" && !getTokens()) {
    return { name: "login" };
  }
  if (to.name === "login" && getTokens()) {
    return { name: "dashboard" };
  }
  return true;
});
