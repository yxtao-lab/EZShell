import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from "./dto/auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 注册账号。
   *
   * @param dto - 注册体
   * @returns 用户与令牌
   */
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * 登录。
   *
   * @param dto - 登录体
   * @returns 用户与令牌
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * 刷新令牌。
   *
   * @param dto - 含 refreshToken
   * @returns 新令牌对
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * 登出并作废刷新令牌。
   *
   * @param dto - 可选 refreshToken
   * @returns 固定成功标记
   */
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken);
    return { ok: true };
  }
}
