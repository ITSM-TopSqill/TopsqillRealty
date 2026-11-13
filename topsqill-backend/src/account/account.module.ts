import { Module } from "@nestjs/common";
import { AccountService } from "./account.service";
import { AccountController } from "./account.controller";
import { MediaModule } from "../media/media.module";

@Module({ imports: [MediaModule], providers: [AccountService], controllers: [AccountController] })
export class AccountModule {}
