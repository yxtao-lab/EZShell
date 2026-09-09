import {
  createParamDecorator,
  ExecutionContext,
} from "@nestjs/common";

/**
 * 从请求中提取当前登录用户。
 *
 * @param data - 未使用
 * @param ctx - 执行上下文
 * @returns `{ id, email }`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{
      user: { id: string; email: string };
    }>();
    return request.user;
  },
);
