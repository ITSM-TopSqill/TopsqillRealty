import { Global, Module } from "@nestjs/common";
import { ClaudeService } from "./claude.service";
import { WriterService } from "./writer.service";
import { ProjectsService } from "./projects.service";
import { AssistantService } from "./assistant.service";
import { ListingChatService } from "./listing-chat.service";
import { AiController } from "./ai.controller";
import { SearchModule } from "../search/search.module";
import { ListingsModule } from "../listings/listings.module";

@Global()
@Module({
  imports: [SearchModule, ListingsModule],
  providers: [ClaudeService, WriterService, ProjectsService, AssistantService, ListingChatService],
  controllers: [AiController],
  exports: [ClaudeService, WriterService, ProjectsService],
})
export class AiModule {}
