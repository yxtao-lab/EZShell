import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 客户端封装，随 Nest 生命周期连接/断开。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * 模块初始化时建立数据库连接。
   *
   * @returns Promise
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * 模块销毁时断开数据库连接。
   *
   * @returns Promise
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
