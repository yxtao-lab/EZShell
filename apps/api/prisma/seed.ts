import { PrismaClient, PlanCode } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * 初始化默认套餐、演示公告与可选管理员账号。
 *
 * @returns Promise
 */
async function main(): Promise<void> {
  const plans = [
    {
      code: PlanCode.free,
      name: "免费版",
      maxHosts: 5,
      cloudSync: false,
      maxDevices: 1,
      teamSeats: null as number | null,
      sharedHostGroups: false,
      monthlyPriceCents: 0,
      yearlyPriceCents: 0,
    },
    {
      code: PlanCode.pro,
      name: "专业版",
      maxHosts: null,
      cloudSync: true,
      maxDevices: 5,
      teamSeats: null,
      sharedHostGroups: false,
      monthlyPriceCents: 2900,
      yearlyPriceCents: 29000,
    },
    {
      code: PlanCode.team,
      name: "团队版",
      maxHosts: null,
      cloudSync: true,
      maxDevices: 20,
      teamSeats: 5,
      sharedHostGroups: true,
      monthlyPriceCents: 9900,
      yearlyPriceCents: 99000,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: {
        name: plan.name,
        maxHosts: plan.maxHosts,
        cloudSync: plan.cloudSync,
        maxDevices: plan.maxDevices,
        teamSeats: plan.teamSeats,
        sharedHostGroups: plan.sharedHostGroups,
        monthlyPriceCents: plan.monthlyPriceCents,
        yearlyPriceCents: plan.yearlyPriceCents,
        active: true,
      },
    });
  }

  const announcementCount = await prisma.announcement.count();
  if (announcementCount === 0) {
    await prisma.announcement.create({
      data: {
        title: "欢迎使用 EZShell",
        content: "P0 骨架已就绪：可注册登录并查看权益。",
        forceUpdate: false,
        published: true,
      },
    });
  }

  const adminEmail = "admin@ezshell.local";
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { email: adminEmail },
  });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("Admin123456", 12);
    await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash,
        displayName: "超级管理员",
      },
    });
    // eslint-disable-next-line no-console
    console.log(`已创建管理员账号：${adminEmail} / Admin123456（仅开发环境）`);
  }

  // eslint-disable-next-line no-console
  console.log("Seed 完成：Free / Pro / Team 套餐已就绪");
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
