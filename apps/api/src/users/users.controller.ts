import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * 获取当前登录用户资料。
   *
   * @param user - 鉴权用户
   * @returns 用户资料与会员摘要
   */
  @Get("me")
  getMe(@CurrentUser() user: { id: string }) {
    return this.usersService.getProfile(user.id);
  }
}
