import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [EntitlementsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
