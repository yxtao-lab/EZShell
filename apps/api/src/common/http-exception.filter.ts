import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { ErrorCode } from "@ezshell/shared";

/**
 * 将异常统一转换为 `{ code, message, details? }` 中文友好响应。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /**
   * @param exception - 捕获到的异常
   * @param host - Nest 参数宿主
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null && "code" in body) {
        response.status(status).json(body);
        return;
      }

      const message =
        typeof body === "string"
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: string[] }).message).join("；")
            : ((body as { message?: string }).message ?? exception.message);

      response.status(status).json({
        code:
          status === HttpStatus.UNAUTHORIZED
            ? ErrorCode.UNAUTHORIZED
            : status === HttpStatus.FORBIDDEN
              ? ErrorCode.FORBIDDEN
              : status === HttpStatus.NOT_FOUND
                ? ErrorCode.NOT_FOUND
                : status === HttpStatus.BAD_REQUEST
                  ? ErrorCode.VALIDATION_FAILED
                  : ErrorCode.UNKNOWN,
        message,
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.error("未处理异常", exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ErrorCode.UNKNOWN,
      message: "服务器内部错误",
    });
  }
}
