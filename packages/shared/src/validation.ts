import { ErrorCode } from "./error-codes";

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * 校验 SSH 端口是否合法（1–65535）。
 *
 * @param port - 待校验端口
 * @returns 合法返回 null；非法返回中文错误信息
 */
export function validatePort(port: unknown): string | null {
  if (typeof port !== "number" || !Number.isInteger(port)) {
    return "端口必须是整数";
  }
  if (port < MIN_PORT || port > MAX_PORT) {
    return `端口必须在 ${MIN_PORT}–${MAX_PORT} 之间`;
  }
  return null;
}

/**
 * 校验新建/编辑主机的必填字段。
 *
 * @param input - 主机表单字段
 * @returns 错误列表；空数组表示通过
 */
export function validateHostInput(input: {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
}): Array<{ field: string; code: string; message: string }> {
  const errors: Array<{ field: string; code: string; message: string }> = [];

  if (!input.name?.trim()) {
    errors.push({
      field: "name",
      code: ErrorCode.HOST_REQUIRED_FIELD,
      message: "请填写主机名称",
    });
  }
  if (!input.host?.trim()) {
    errors.push({
      field: "host",
      code: ErrorCode.HOST_REQUIRED_FIELD,
      message: "请填写主机地址",
    });
  }
  if (!input.username?.trim()) {
    errors.push({
      field: "username",
      code: ErrorCode.HOST_REQUIRED_FIELD,
      message: "请填写用户名",
    });
  }

  const portError = validatePort(input.port ?? NaN);
  if (portError) {
    errors.push({
      field: "port",
      code: ErrorCode.HOST_INVALID_PORT,
      message: portError,
    });
  }

  return errors;
}

/**
 * 简单校验邮箱格式（首期注册用）。
 *
 * @param email - 邮箱地址
 * @returns 是否看起来像合法邮箱
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
