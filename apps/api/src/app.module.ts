import { Module } from "@nestjs/common";
import { CsvGateway } from "./csv/csv.gateway";
import { CsvController } from "./csv/csv.controller";
import { CsvService } from "./csv/csv.service";
import { DatabaseService } from "./database/database.service";

@Module({
  imports: [],
  controllers: [CsvController],
  providers: [CsvGateway, CsvService, DatabaseService]
})
export class AppModule {}
