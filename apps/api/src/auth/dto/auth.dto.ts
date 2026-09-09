import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "请输入有效的邮箱地址" })
  email!: string;

  @IsString({ message: "密码必须是字符串" })
  @MinLength(8, { message: "密码至少 8 位" })
  password!: string;

  @IsOptional()
  @IsString({ message: "昵称必须是字符串" })
  nickname?: string;
}

export class LoginDto {
  @IsEmail({}, { message: "请输入有效的邮箱地址" })
  email!: string;

  @IsString({ message: "密码必须是字符串" })
  @MinLength(1, { message: "请输入密码" })
  password!: string;
}

export class RefreshDto {
  @IsString({ message: "refreshToken 必须是字符串" })
  refreshToken!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString({ message: "refreshToken 必须是字符串" })
  refreshToken?: string;
}
