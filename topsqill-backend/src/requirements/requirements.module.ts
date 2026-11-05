import { Module } from "@nestjs/common";
import { RequirementsService } from "./requirements.service";
import { RequirementsController } from "./requirements.controller";

@Module({ providers: [RequirementsService], controllers: [RequirementsController], exports: [RequirementsService] })
export class RequirementsModule {}
