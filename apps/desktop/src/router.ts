import { createRouter, createWebHashHistory } from "vue-router";
import ShellView from "./views/ShellView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: ShellView }],
});
