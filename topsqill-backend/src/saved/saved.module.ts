import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { SavedService } from "./saved.service";
import { SavedController } from "./saved.controller";

@Module({ imports: [MediaModule], providers: [SavedService], controllers: [SavedController], exports: [SavedService] })
export class SavedModule {}
