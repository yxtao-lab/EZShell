import { EzshellSdk } from "@ezshell/sdk";
import { getTokens, setTokens } from "./auth-store";

const baseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api";

/** 管理后台共用的 API SDK 实例 */
export const api = new EzshellSdk({
  baseUrl,
  getTokens,
  setTokens,
});
