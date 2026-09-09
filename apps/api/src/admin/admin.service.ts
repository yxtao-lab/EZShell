import { Injectable } from "@nestjs/common";
import { HttpStatus } from "@nestjs/common";
import { PlanCode, SubscriptionStatus } from "@prisma/client";
import { ErrorCode } from "@ezshell/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { throwBizError } from "../common/biz-error";

/**
 * 管理端业务：手动开通会员等。
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * 手动开通或变更用户会员档位。
   *
   * @param actorUserId - 操作者用户 ID（写入审计）
   * @param userId - 目标用户
   * @param input.planCode - 目标套餐
   * @param input.expiresAt - 到期 ISO 时间；缺省则 Pro/Team 默认 +1 年，Free 为长期
   * @param input.reason - 操作原因
   * @returns 订阅摘要
   * @throws 用户或套餐不存在
   */
  async grantMembership(
    actorUserId: string,
    userId: string,
    input: {
      planCode: PlanCode;
      expiresAt?: string;
      reason?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throwBizError(ErrorCode.NOT_FOUND, "用户不存在", HttpStatus.NOT_FOUND);
    }

    const plan = await this.prisma.plan.findUnique({
      where: { code: input.planCode },
    });
    if (!plan) {
      throwBizError(ErrorCode.NOT_FOUND, "套餐不存在", HttpStatus.NOT_FOUND);
    }

    const expiresAt =
      input.expiresAt != null
        ? new Date(input.expiresAt)
        : input.planCode === PlanCode.free
          ? null
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const subscription = await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId: plan.id,
        status: SubscriptionStatus.active,
        startsAt: new Date(),
        expiresAt,
      },
      update: {
        planId: plan.id,
        status: SubscriptionStatus.active,
        startsAt: new Date(),
        expiresAt,
      },
      include: { plan: true },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "grant_membership",
        target: userId,
        detail: {
          actorUserId,
          planCode: input.planCode,
          expiresAt,
          reason: input.reason ?? null,
        },
      },
    });

    await this.entitlements.invalidateCache(userId);

    return {
      userId,
      planCode: subscription.plan.code,
      planName: subscription.plan.name,
      status: subscription.status,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
    };
  }
}
