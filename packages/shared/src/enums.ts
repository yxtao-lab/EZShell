/** 会员档位编码 */
export const PlanCode = {
  FREE: "free",
  PRO: "pro",
  TEAM: "team",
} as const;

export type PlanCodeValue = (typeof PlanCode)[keyof typeof PlanCode];

/** 订阅状态 */
export const SubscriptionStatus = {
  NONE: "none",
  ACTIVE: "active",
  GRACE: "grace",
  EXPIRED: "expired",
} as const;

export type SubscriptionStatusValue =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** 计费周期 */
export const BillingCycle = {
  MONTHLY: "monthly",
  YEARLY: "yearly",
} as const;

export type BillingCycleValue = (typeof BillingCycle)[keyof typeof BillingCycle];

/** 订单状态 */
export const OrderStatus = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  CLOSED: "closed",
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

/** SSH 认证方式 */
export const AuthMethod = {
  PASSWORD: "password",
  PRIVATE_KEY: "privateKey",
  AGENT: "agent",
} as const;

export type AuthMethodValue = (typeof AuthMethod)[keyof typeof AuthMethod];

/** 端口转发类型 */
export const ForwardType = {
  LOCAL: "local",
  REMOTE: "remote",
} as const;

export type ForwardTypeValue = (typeof ForwardType)[keyof typeof ForwardType];

/** 连接状态（客户端展示） */
export const ConnectionStatus = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
} as const;

export type ConnectionStatusValue =
  (typeof ConnectionStatus)[keyof typeof ConnectionStatus];
