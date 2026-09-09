import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ErrorCode } from "@ezshell/shared";
import { HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { throwBizError } from "../common/biz-error";

export interface JwtPayload {
  sub: string;
  email: string;
  typ: string;
}

/**
 * Access Token JWT 策略。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("JWT_ACCESS_SECRET") ?? "dev-access",
    });
  }

  /**
   * 校验载荷并加载用户；封禁用户拒绝访问。
   *
   * @param payload - JWT 载荷
   * @returns 注入到 request.user 的对象
   * @throws 令牌类型错误或用户不存在/封禁
   */
  async validate(payload: JwtPayload): Promise<{
    id: string;
    email: string;
  }> {
    if (payload.typ !== "access") {
      throwBizError(
        ErrorCode.AUTH_TOKEN_INVALID,
        "无效的访问令牌",
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.banned) {
      throwBizError(
        ErrorCode.UNAUTHORIZED,
        "未授权或账号不可用",
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { id: user.id, email: user.email };
  }
}
