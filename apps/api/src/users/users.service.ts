import { Injectable } from "@nestjs/common";
import { HttpStatus } from "@nestjs/common";
import { ErrorCode } from "@ezshell/shared";
import { PrismaService } from "../prisma/prisma.service";
import { throwBizError } from "../common/biz-error";

/**
 * 用户资料服务。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询用户个人中心信息。
   *
   * @param userId - 用户 ID
   * @returns 昵称、账号、会员状态与到期时间
   * @throws 用户不存在时抛出
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });
    if (!user) {
      throwBizError(ErrorCode.NOT_FOUND, "用户不存在", HttpStatus.NOT_FOUND);
    }

    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      membership: {
        planCode: user.subscription?.plan.code ?? "free",
        planName: user.subscription?.plan.name ?? "免费版",
        status: user.subscription?.status ?? "none",
        expiresAt: user.subscription?.expiresAt?.toISOString() ?? null,
      },
    };
  }
}
