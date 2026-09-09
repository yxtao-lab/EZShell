import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Access Token 鉴权守卫。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
