import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { CommandCentreService } from "./command-centre.service";
import { CurrentUser, AuthUser } from "../auth/public.decorator";

@ApiTags("command-centre")
@Controller("v1/command-centre")
export class CommandCentreController {
  constructor(private readonly svc: CommandCentreService) {}

  @Get() @ApiOperation({ summary: "The AI Marketing Command Centre: one real-data view across campaigns, AI activity, approvals, integrations, businesses and segments" })
  overview(@CurrentUser() user: AuthUser) { return this.svc.overview(user.id); }
}
