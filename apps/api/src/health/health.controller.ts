import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 健康检查：探测进程、数据库与 Redis。
   *
   * @returns 各组件状态
   */
  @Get()
  async check(): Promise<{
    status: string;
    service: string;
    database: string;
    redis: string;
  }> {
    let database = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }

    const redisOk = await this.redis.ping();
    const redis = redisOk ? "up" : "down";
    const status = database === "up" && redis === "up" ? "ok" : "degraded";

    return {
      status,
      service: "ezshell-api",
      database,
      redis,
    };
  }
}
