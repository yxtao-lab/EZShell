import { createRouter, createWebHashHistory } from "vue-router";
import MobileShell from "./views/MobileShell.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: MobileShell }],
});
