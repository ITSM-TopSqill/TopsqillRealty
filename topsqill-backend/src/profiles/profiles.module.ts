import { Module } from "@nestjs/common";
import { ProfilesService } from "./profiles.service";
import { ProfilesController } from "./profiles.controller";
import { MediaModule } from "../media/media.module";

@Module({ imports: [MediaModule], providers: [ProfilesService], controllers: [ProfilesController], exports: [ProfilesService] })
export class ProfilesModule {}
