import { Module } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";
import { IngestService } from "./ingest.service";
import { IngestController } from "./ingest.controller";

@Module({
  providers: [LeadsService, IngestService],
  controllers: [LeadsController, IngestController],
  exports: [LeadsService, IngestService],
})
export class LeadsModule {}
