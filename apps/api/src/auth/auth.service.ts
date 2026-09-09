import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PlanCode, SubscriptionStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { ErrorCode } from "@ezshell/shared";
import { HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { throwBizError } from "../common/biz-error";
import type { LoginDto, RegisterDto } from "./dto/auth.dto";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserView {
  id: string;
  email: string;
  nickname: string | null;
}

/**
 * 认证服务：注册、登录、刷新与登出。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 邮箱注册；自动绑定 Free 订阅。
   *
   * @param dto - 注册参数
   * @returns 用户与令牌
   * @throws 邮箱已被占用时抛出业务错误
   */
  async register(dto: RegisterDto): Promise<{
    user: AuthUserView;
    tokens: AuthTokens;
  }> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throwBizError(
        ErrorCode.AUTH_EMAIL_TAKEN,
        "该邮箱已被注册",
        HttpStatus.CONFLICT,
      );
    }

    const saltRounds = Number(this.config.get("BCRYPT_SALT_ROUNDS") ?? 12);
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const freePlan = await this.prisma.plan.findUnique({
      where: { code: PlanCode.free },
    });
    if (!freePlan) {
      throwBizError(
        ErrorCode.UNKNOWN,
        "系统未初始化套餐数据，请先执行 seed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        nickname: dto.nickname?.trim() || null,
        subscription: {
          create: {
            planId: freePlan.id,
            status: SubscriptionStatus.active,
            startsAt: new Date(),
            expiresAt: null,
          },
        },
      },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return {
      user: this.toUserView(user),
      tokens,
    };
  }

  /**
   * 邮箱密码登录。
   *
   * @param dto - 登录参数
   * @returns 用户与令牌
   * @throws 凭证错误或账号封禁时抛出业务错误
   */
  async login(dto: LoginDto): Promise<{
    user: AuthUserView;
    tokens: AuthTokens;
  }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throwBizError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        "邮箱或密码错误",
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.banned) {
      throwBizError(ErrorCode.FORBIDDEN, "账号已被封禁", HttpStatus.FORBIDDEN);
    }

    const matched = await bcrypt.compare(dto.password, user.passwordHash);
    if (!matched) {
      throwBizError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        "邮箱或密码错误",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.issueTokens(user.id, user.email);
    return {
      user: this.toUserView(user),
      tokens,
    };
  }

  /**
   * 使用刷新令牌换取新的令牌对；旧刷新令牌立即作废。
   *
   * @param refreshToken - 明文刷新令牌
   * @returns 新令牌对
   * @throws 令牌无效或已撤销时抛出业务错误
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throwBizError(
        ErrorCode.AUTH_REFRESH_REVOKED,
        "刷新令牌无效或已过期，请重新登录",
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (record.user.banned) {
      throwBizError(ErrorCode.FORBIDDEN, "账号已被封禁", HttpStatus.FORBIDDEN);
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.user.id, record.user.email);
  }

  /**
   * 登出：作废指定刷新令牌。
   *
   * @param refreshToken - 可选刷新令牌；缺省则仅视为客户端清理
   * @returns Promise
   */
  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * 签发 Access + Refresh，并持久化刷新令牌哈希。
   *
   * @param userId - 用户 ID
   * @param email - 用户邮箱
   * @returns 令牌对
   */
  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const accessSecret =
      this.config.get<string>("JWT_ACCESS_SECRET") ?? "dev-access";
    const refreshSecret =
      this.config.get<string>("JWT_REFRESH_SECRET") ?? "dev-refresh";
    const accessExpiresIn =
      this.config.get<string>("JWT_ACCESS_EXPIRES_IN") ?? "15m";
    const refreshExpiresIn =
      this.config.get<string>("JWT_REFRESH_EXPIRES_IN") ?? "30d";

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, typ: "access" },
      {
        secret: accessSecret,
        expiresIn: accessExpiresIn as `${number}m` | `${number}d` | `${number}h` | `${number}s`,
      },
    );

    const refreshToken = randomBytes(48).toString("base64url");
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = this.computeExpiry(refreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    // 刷新令牌本身不走 JWT，避免与 access 混用同一校验路径
    void refreshSecret;

    return { accessToken, refreshToken };
  }

  /**
   * 将明文刷新令牌哈希后存储，避免库泄露可直接复用。
   *
   * @param token - 明文令牌
   * @returns SHA-256 十六进制哈希
   */
  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * 将类似 `30d` / `15m` 的过期表达式转为绝对时间。
   *
   * @param expression - 过期表达式
   * @returns 过期时间点
   */
  private computeExpiry(expression: string): Date {
    const match = /^(\d+)([smhd])$/.exec(expression.trim());
    if (!match) {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + amount * (multipliers[unit] ?? 0));
  }

  /**
   * 转为对外用户视图。
   *
   * @param user - 数据库用户
   * @returns 脱敏用户信息
   */
  private toUserView(user: {
    id: string;
    email: string;
    nickname: string | null;
  }): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
    };
  }
}
