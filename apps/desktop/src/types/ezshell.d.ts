import type {
  AuthMethodValue,
  ForwardRule,
  ForwardTypeValue,
  HostGroup,
  HostRecord,
  KeyMetadata,
  SnippetRecord,
} from "@ezshell/shared";

export type ConnectionStatusValue =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

export interface TerminalSessionView {
  id: string;
  hostId: string;
  title: string;
  status: ConnectionStatusValue;
  message: string;
  authFailed: boolean;
}

export interface HostUpsertInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethodValue;
  keyId?: string | null;
  groupId?: string | null;
  tags?: string[];
  remark?: string;
  jumpHostId?: string | null;
  hostFingerprint?: string | null;
}

export interface SftpEntry {
  name: string;
  longname: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
}

export interface EzshellDesktopApi {
  platform: string;
  appName: string;
  listHosts: () => Promise<HostRecord[]>;
  upsertHost: (
    input: HostUpsertInput,
  ) => Promise<
    | { ok: true; host: HostRecord }
    | { ok: false; errors: Array<{ field: string; message: string }> }
  >;
  deleteHost: (id: string) => Promise<boolean>;
  listGroups: () => Promise<HostGroup[]>;
  upsertGroup: (
    input: { id?: string; name: string },
  ) => Promise<{ ok: true; group: HostGroup } | { ok: false; message: string }>;
  deleteGroup: (id: string) => Promise<boolean>;
  hasPassword: (hostId: string) => Promise<boolean>;
  deletePassword: (hostId: string) => Promise<boolean>;
  listKeys: () => Promise<KeyMetadata[]>;
  generateKey: (
    name: string,
  ) => Promise<{ ok: true; key: KeyMetadata } | { ok: false; message: string }>;
  importKey: (input: {
    name: string;
    privateKey: string;
    passphrase?: string;
  }) => Promise<{ ok: true; key: KeyMetadata } | { ok: false; message: string }>;
  deleteKey: (id: string) => Promise<boolean>;
  getPublicKey: (id: string) => Promise<string | null>;
  connectSsh: (options: {
    sessionId: string;
    hostId: string;
    password?: string;
    rememberPassword?: boolean;
    acceptFingerprint?: boolean;
    pendingFingerprint?: string;
  }) => Promise<{ ok: boolean; code?: string; message?: string }>;
  disconnectSsh: (sessionId: string) => Promise<boolean>;
  writeSsh: (sessionId: string, data: string) => void;
  resizeSsh: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  resolveFingerprint: (
    sessionId: string,
    accepted: boolean,
  ) => Promise<{ ok: boolean; message?: string }>;

  sftpList: (
    sessionId: string,
    remotePath?: string,
  ) => Promise<{
    ok: boolean;
    cwd?: string;
    entries?: SftpEntry[];
    message?: string;
  }>;
  sftpUp: (
    sessionId: string,
  ) => Promise<{
    ok: boolean;
    cwd?: string;
    entries?: SftpEntry[];
    message?: string;
  }>;
  sftpRename: (
    sessionId: string,
    fromPath: string,
    toPath: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  sftpDelete: (
    sessionId: string,
    remotePath: string,
    isDirectory?: boolean,
  ) => Promise<{ ok: boolean; message?: string }>;
  sftpDownload: (
    sessionId: string,
    remotePath: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  sftpUpload: (
    sessionId: string,
    remoteDir: string,
  ) => Promise<{ ok: boolean; message?: string }>;

  listSnippets: () => Promise<SnippetRecord[]>;
  upsertSnippet: (input: {
    id?: string;
    title: string;
    content: string;
    category?: string | null;
    autoNewline?: boolean;
  }) => Promise<{ ok: true; snippet: SnippetRecord } | { ok: false; message: string }>;
  deleteSnippet: (id: string) => Promise<boolean>;
  sendSnippet: (payload: {
    snippetId: string;
    sessionId: string | null;
    hostId: string;
  }) => Promise<{ ok: boolean; message?: string }>;

  listForwards: () => Promise<ForwardRule[]>;
  upsertForward: (input: {
    id?: string;
    name: string;
    hostId: string;
    type: ForwardTypeValue;
    bindPort: number;
    targetHost: string;
    targetPort: number;
    enabled?: boolean;
  }) => Promise<{ ok: true; forward: ForwardRule } | { ok: false; message: string }>;
  deleteForward: (id: string) => Promise<boolean>;
  startForward: (
    ruleId: string,
    auth?: { password?: string; rememberPassword?: boolean },
  ) => Promise<{ ok: boolean; message?: string; code?: string }>;
  stopForward: (ruleId: string) => Promise<{ ok: boolean }>;
  listRunningForwards: () => Promise<string[]>;

  exportBackup: (options?: {
    encrypted?: boolean;
    password?: string;
    includeSecrets?: boolean;
  }) => Promise<{ ok: boolean; message?: string; filePath?: string }>;
  importBackup: (options?: {
    password?: string;
    mode?: "merge" | "replace";
  }) => Promise<{ ok: boolean; message?: string; imported?: object }>;
  importOpenSsh: () => Promise<{ ok: boolean; message?: string; imported?: number }>;
  importMoba: () => Promise<{ ok: boolean; message?: string; imported?: number }>;
  getAppVersion: () => Promise<string>;
  writeClipboard: (text: string) => Promise<boolean>;
  readClipboard: () => Promise<string>;
  openExternal: (url: string) => Promise<{ ok: boolean; message?: string }>;

  onSshData: (listener: (payload: { sessionId: string; data: string }) => void) => () => void;
  onSshStatus: (
    listener: (payload: {
      sessionId: string;
      hostId: string;
      status: ConnectionStatusValue;
      message: string;
    }) => void,
  ) => () => void;
  onSshNeedPassword: (
    listener: (payload: {
      sessionId: string;
      hostId: string;
      reason: string;
      message: string;
    }) => void,
  ) => () => void;
  onSshFingerprint: (
    listener: (payload: {
      sessionId: string;
      hostId: string;
      fingerprint: string;
      changed: boolean;
      message: string;
    }) => void,
  ) => () => void;
  onSshClosed: (
    listener: (payload: { sessionId: string; hostId: string }) => void,
  ) => () => void;
  onForwardStatus: (
    listener: (payload: {
      ruleId: string;
      running: boolean;
      message: string;
    }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    ezshell: EzshellDesktopApi;
  }
}

export {};
