import type { ApiErrorBody, Entitlements } from "@ezshell/shared";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  nickname: string | null;
}

/** 个人中心资料（含会员摘要，对应 GET /users/me） */
export interface UserProfile extends AuthUser {
  membership: {
    planCode: string;
    planName: string;
    status: string;
    expiresAt: string | null;
  };
}

export interface LoginResult {
  user: AuthUser;
  tokens: TokenPair;
}

export interface EzshellSdkOptions {
  /** API 根路径，例如 http://localhost:3000/api */
  baseUrl: string;
  /** 读取本地持久化的令牌 */
  getTokens?: () => TokenPair | null | Promise<TokenPair | null>;
  /** 写入令牌；传 null 表示清除 */
  setTokens?: (tokens: TokenPair | null) => void | Promise<void>;
}

/**
 * EZShell API TypeScript SDK。
 * 负责鉴权头注入与 Access Token 过期后的刷新重试。
 */
export class EzshellSdk {
  private readonly baseUrl: string;
  private readonly getTokens?: EzshellSdkOptions["getTokens"];
  private readonly setTokens?: EzshellSdkOptions["setTokens"];
  private refreshing: Promise<TokenPair | null> | null = null;

  /**
   * @param options - SDK 配置
   */
  constructor(options: EzshellSdkOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getTokens = options.getTokens;
    this.setTokens = options.setTokens;
  }

  /**
   * 健康检查。
   *
   * @returns 服务状态文案
   */
  async health(): Promise<{ status: string; service: string }> {
    return this.request("GET", "/health", { auth: false });
  }

  /**
   * 邮箱注册并返回令牌。
   *
   * @param email - 邮箱
   * @param password - 密码（至少 8 位）
   * @param nickname - 可选昵称
   * @returns 用户与令牌
   */
  async register(
    email: string,
    password: string,
    nickname?: string,
  ): Promise<LoginResult> {
    const result = await this.request<LoginResult>("POST", "/auth/register", {
      auth: false,
      body: { email, password, nickname },
    });
    await this.setTokens?.(result.tokens);
    return result;
  }

  /**
   * 邮箱登录。
   *
   * @param email - 邮箱
   * @param password - 密码
   * @returns 用户与令牌
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.request<LoginResult>("POST", "/auth/login", {
      auth: false,
      body: { email, password },
    });
    await this.setTokens?.(result.tokens);
    return result;
  }

  /**
   * 登出并作废当前刷新令牌。
   *
   * @returns 无返回值
   */
  async logout(): Promise<void> {
    const tokens = await this.getTokens?.();
    try {
      await this.request("POST", "/auth/logout", {
        body: { refreshToken: tokens?.refreshToken },
      });
    } finally {
      await this.setTokens?.(null);
    }
  }

  /**
   * 查询当前用户资料（含会员摘要）。
   *
   * @returns 用户资料与会员状态
   */
  async getMe(): Promise<UserProfile> {
    return this.request("GET", "/users/me");
  }

  /**
   * 查询当前会员权益（服务端权威）。
   *
   * @returns 权益快照
   */
  async getEntitlements(): Promise<Entitlements> {
    return this.request("GET", "/me/entitlements");
  }

  /**
   * 拉取公告列表。
   *
   * @returns 公告数组
   */
  async getAnnouncements(): Promise<
    Array<{ id: string; title: string; content: string; forceUpdate: boolean }>
  > {
    return this.request("GET", "/announcements", { auth: false });
  }

  /**
   * 发起带鉴权的 HTTP 请求；401 时尝试刷新令牌并重试一次。
   *
   * @param method - HTTP 方法
   * @param path - 相对 API 路径
   * @param options.auth - 是否附带 Access Token，默认 true
   * @param options.body - JSON 请求体
   * @param options.retry - 是否允许刷新后重试，默认 true
   * @returns 解析后的 JSON 数据
   * @throws {SdkError} 业务或网络错误
   */
  private async request<T = unknown>(
    method: string,
    path: string,
    options: {
      auth?: boolean;
      body?: unknown;
      retry?: boolean;
    } = {},
  ): Promise<T> {
    const { auth = true, body, retry = true } = options;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (auth) {
      const tokens = await this.getTokens?.();
      if (tokens?.accessToken) {
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new SdkError("NETWORK_ERROR", "网络请求失败，请检查服务是否启动", {
        cause: error,
      });
    }

    if (response.status === 401 && auth && retry) {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        return this.request<T>(method, path, { ...options, retry: false });
      }
    }

    const payload = await this.parseJson(response);
    if (!response.ok) {
      const err = payload as ApiErrorBody;
      throw new SdkError(
        err?.code ?? "UNKNOWN",
        err?.message ?? `请求失败（${response.status}）`,
        { status: response.status, details: err?.details },
      );
    }
    return payload as T;
  }

  /**
   * 使用 Refresh Token 换取新的令牌对。
   *
   * @returns 新令牌；失败则清除本地令牌并返回 null
   */
  private async refreshTokens(): Promise<TokenPair | null> {
    if (this.refreshing) {
      return this.refreshing;
    }

    this.refreshing = (async () => {
      const tokens = await this.getTokens?.();
      if (!tokens?.refreshToken) {
        await this.setTokens?.(null);
        return null;
      }
      try {
        const next = await this.request<TokenPair>("POST", "/auth/refresh", {
          auth: false,
          body: { refreshToken: tokens.refreshToken },
          retry: false,
        });
        await this.setTokens?.(next);
        return next;
      } catch {
        await this.setTokens?.(null);
        return null;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /**
   * 安全解析 JSON；空响应返回空对象。
   *
   * @param response - Fetch 响应
   * @returns 解析结果
   */
  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}

/**
 * SDK 抛出的业务/网络错误。
 */
export class SdkError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  /**
   * @param code - 错误码
   * @param message - 中文可读信息
   * @param options.status - HTTP 状态码
   * @param options.details - 附加详情
   * @param options.cause - 原始异常
   */
  constructor(
    code: string,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "SdkError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export type { Entitlements };
