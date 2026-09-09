import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { PlanCode } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AdminService } from "./admin.service";

class GrantMembershipDto {
  @IsEnum(PlanCode, { message: "套餐编码无效" })
  planCode!: PlanCode;

  @IsOptional()
  @IsDateString({}, { message: "到期时间格式无效" })
  expiresAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * 管理端接口骨架（P0：鉴权暂复用用户 JWT，P5 切换独立管理员鉴权）。
 */
@Controller("admin")
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * 手动为用户开通/改档会员（支付方案 A）。
   *
   * @param actor - 当前操作者（后续校验管理员角色）
   * @param userId - 目标用户 ID
   * @param dto - 套餐与到期时间
   * @returns 更新后的订阅摘要
   */
  @Post("users/:userId/membership")
  grantMembership(
    @CurrentUser() actor: { id: string },
    @Param("userId") userId: string,
    @Body() dto: GrantMembershipDto,
  ) {
    return this.adminService.grantMembership(actor.id, userId, dto);
  }
}
