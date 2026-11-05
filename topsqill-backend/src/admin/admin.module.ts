import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ReportsController } from "./reports.controller";

@Module({ providers: [AdminService], controllers: [AdminController, ReportsController], exports: [AdminService] })
export class AdminModule {}
