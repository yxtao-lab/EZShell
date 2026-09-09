import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { EntitlementsService } from "./entitlements.service";

@Controller("me")
@UseGuards(JwtAuthGuard)
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  /**
   * 返回当前用户权益快照（服务端权威）。
   *
   * @param user - 鉴权用户
   * @returns 权益对象
   */
  @Get("entitlements")
  getEntitlements(@CurrentUser() user: { id: string }) {
    return this.entitlementsService.getForUser(user.id);
  }
}
