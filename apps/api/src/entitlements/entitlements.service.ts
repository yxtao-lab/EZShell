import { Injectable } from "@nestjs/common";
import { SubscriptionStatus } from "@prisma/client";
import type { Entitlements } from "@ezshell/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

const CACHE_TTL_SECONDS = 60;

/**
 * 会员权益查询与短期缓存。
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 获取用户权益；优先读 Redis 短期缓存。
   *
   * @param userId - 用户 ID
   * @returns 权益快照
   */
  async getForUser(userId: string): Promise<Entitlements> {
    const cacheKey = `entitlements:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Entitlements;
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });

    const plan =
      subscription?.plan ??
      (await this.prisma.plan.findUnique({ where: { code: "free" } }));

    const status = this.resolveStatus(subscription?.status, subscription?.expiresAt);
    const effectivePlan =
      status === "expired" || status === "none"
        ? ((await this.prisma.plan.findUnique({ where: { code: "free" } })) ??
          plan)
        : plan;

    const entitlements: Entitlements = {
      planCode: (effectivePlan?.code ?? "free") as Entitlements["planCode"],
      planName: effectivePlan?.name ?? "免费版",
      status,
      expiresAt: subscription?.expiresAt?.toISOString() ?? null,
      maxHosts: effectivePlan?.maxHosts ?? 5,
      cloudSync: effectivePlan?.cloudSync ?? false,
      maxDevices: effectivePlan?.maxDevices ?? 1,
      teamSeats: effectivePlan?.teamSeats ?? null,
      sharedHostGroups: effectivePlan?.sharedHostGroups ?? false,
    };

    await this.redis.setex(
      cacheKey,
      JSON.stringify(entitlements),
      CACHE_TTL_SECONDS,
    );
    return entitlements;
  }

  /**
   * 清除用户权益缓存（开通/改档后调用）。
   *
   * @param userId - 用户 ID
   * @returns Promise
   */
  async invalidateCache(userId: string): Promise<void> {
    await this.redis.del(`entitlements:${userId}`);
  }

  /**
   * 根据订阅状态与到期时间解析对外状态。
   *
   * @param status - 库中状态
   * @param expiresAt - 到期时间；null 表示长期有效
   * @returns 对外状态字符串
   */
  private resolveStatus(
    status: SubscriptionStatus | undefined,
    expiresAt: Date | null | undefined,
  ): string {
    if (!status || status === SubscriptionStatus.none) {
      return "none";
    }
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return "expired";
    }
    return status;
  }
}
