import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";

/**
 * 启动 EZShell API 服务。
 *
 * @returns Promise，在监听端口后 resolve
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const origins = (config.get<string>("CORS_ORIGINS") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = Number(config.get("API_PORT") ?? 3000);
  const host = config.get<string>("API_HOST") ?? "0.0.0.0";
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`EZShell API 已启动：http://${host === "0.0.0.0" ? "localhost" : host}:${port}/api`);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("API 启动失败", error);
  process.exit(1);
});
