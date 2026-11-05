import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsIn, IsString } from "class-validator";
import { SavedService, SavedType } from "./saved.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

class SaveDto {
  @IsIn(["listing", "profile", "project", "job"]) itemType: SavedType;
  @IsString() itemId: string;
}

@ApiTags("saved")
@Controller("v1/saved")
export class SavedController {
  constructor(private readonly svc: SavedService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("type") type?: SavedType) { return this.svc.list(user.id, type ?? "listing"); }

  @Post()
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveDto) { return this.svc.save(user.id, dto.itemType, dto.itemId); }

  @Delete()
  unsave(@CurrentUser() user: AuthUser, @Body() dto: SaveDto) { return this.svc.unsave(user.id, dto.itemType, dto.itemId); }
}
