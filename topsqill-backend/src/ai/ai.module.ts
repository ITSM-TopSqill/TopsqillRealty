import { Global, Module } from "@nestjs/common";
import { ClaudeService } from "./claude.service";
import { WriterService } from "./writer.service";
import { ProjectsService } from "./projects.service";
import { AiController } from "./ai.controller";
import { SearchModule } from "../search/search.module";
import { ListingsModule } from "../listings/listings.module";

@Global()
@Module({
  imports: [SearchModule, ListingsModule],
  providers: [ClaudeService, WriterService, ProjectsService],
  controllers: [AiController],
  exports: [ClaudeService, WriterService, ProjectsService],
})
export class AiModule {}
