import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("announcements")
export class AnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 拉取已发布公告（客户端可匿名访问）。
   *
   * @returns 公告列表
   */
  @Get()
  async list() {
    const items = await this.prisma.announcement.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      forceUpdate: item.forceUpdate,
      createdAt: item.createdAt.toISOString(),
    }));
  }
}
