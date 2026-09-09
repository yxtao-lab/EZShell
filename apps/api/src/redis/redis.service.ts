import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Redis 封装：会话缓存、限流与短期权益缓存。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  /**
   * @param config - 环境配置
   */
  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  /**
   * 确保已连接 Redis。
   *
   * @returns Promise
   */
  async connect(): Promise<void> {
    if (this.client.status === "wait" || this.client.status === "end") {
      await this.client.connect();
    }
  }

  /**
   * 写入带过期时间的字符串值。
   *
   * @param key - 键
   * @param value - 值
   * @param ttlSeconds - 过期秒数
   * @returns Promise
   */
  async setex(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.connect();
    await this.client.setex(key, ttlSeconds, value);
  }

  /**
   * 读取字符串值。
   *
   * @param key - 键
   * @returns 值；不存在返回 null
   */
  async get(key: string): Promise<string | null> {
    await this.connect();
    return this.client.get(key);
  }

  /**
   * 删除键。
   *
   * @param key - 键
   * @returns Promise
   */
  async del(key: string): Promise<void> {
    await this.connect();
    await this.client.del(key);
  }

  /**
   * 探测 Redis 是否可用。
   *
   * @returns 是否 pong
   */
  async ping(): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  /**
   * 模块销毁时关闭连接。
   *
   * @returns Promise
   */
  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
