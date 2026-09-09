import {
  HttpException,
  HttpStatus,
} from "@nestjs/common";

/**
 * 抛出带业务错误码的 HTTP 异常，供全局过滤器原样输出。
 *
 * @param code - 业务错误码
 * @param message - 中文提示
 * @param status - HTTP 状态码
 * @param details - 可选详情
 * @returns 永不返回（抛出）
 * @throws {HttpException} 始终抛出
 */
export function throwBizError(
  code: string,
  message: string,
  status: HttpStatus = HttpStatus.BAD_REQUEST,
  details?: unknown,
): never {
  throw new HttpException({ code, message, details }, status);
}
