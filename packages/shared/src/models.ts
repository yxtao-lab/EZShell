import type { AuthMethodValue, ForwardTypeValue, PlanCodeValue } from "./enums";

/** 主机记录（多端共用模型） */
export interface HostRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethodValue;
  /** 绑定的本地密钥 ID；公钥认证时使用 */
  keyId?: string | null;
  groupId?: string | null;
  /** 跳板机预留字段，首期不实现链路 */
  jumpHostId?: string | null;
  tags?: string[];
  remark?: string;
  /** 已确认的主机指纹（如 SHA256:...） */
  hostFingerprint?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 主机分组 */
export interface HostGroup {
  id: string;
  name: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

/** 密钥元数据（私钥本体不进此结构上云） */
export interface KeyMetadata {
  id: string;
  name: string;
  type: "ed25519" | "rsa";
  fingerprint: string;
  publicKey: string;
  hasPassphrase: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 命令片段 */
export interface SnippetRecord {
  id: string;
  title: string;
  content: string;
  category?: string | null;
  autoNewline?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 端口转发规则 */
export interface ForwardRule {
  id: string;
  name: string;
  hostId: string;
  type: ForwardTypeValue;
  bindPort: number;
  targetHost: string;
  targetPort: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 当前用户权益快照（服务端权威） */
export interface Entitlements {
  planCode: PlanCodeValue;
  planName: string;
  status: string;
  expiresAt: string | null;
  maxHosts: number | null;
  cloudSync: boolean;
  maxDevices: number | null;
  teamSeats: number | null;
  sharedHostGroups: boolean;
}

/** EZShell 备份文件顶层结构标识 */
export interface BackupEnvelope {
  app: "EZShell";
  version: number;
  exportedAt: string;
  encrypted: boolean;
}
