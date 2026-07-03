import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { CsvGateway } from "./csv.gateway";
import { CsvService } from "./csv.service";

@Controller()
export class CsvController {
  constructor(
    private readonly csvService: CsvService,
    private readonly gateway: CsvGateway
  ) {}

  @Get("health")
  health() {
    return { ok: true };
  }

  @Post("uploads")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }
    })
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("CSV file is required");
    }
    if (!file.originalname.toLowerCase().endsWith(".csv") && file.mimetype !== "text/csv") {
      throw new BadRequestException("Only CSV files are supported");
    }

    const summary = await this.csvService.importCsv(file.buffer);
    this.gateway.emitImport(summary);

    if (summary.inserted > 0 || summary.conflicts.length > 0) {
      const records = await this.csvService.listRecords("", 1, 20);
      this.gateway.emitRecordsChanged({
        records: records.data,
        reason: "upload"
      });
    }

    return summary;
  }

  @Get("records")
  listRecords(
    @Query("q") q = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20"
  ) {
    return this.csvService.listRecords(q, Number(page), Number(pageSize));
  }

  @Get("conflicts")
  listConflicts() {
    return this.csvService.listConflicts();
  }

  @Post("conflicts/:id/resolve")
  async resolveConflict(
    @Param("id") id: string,
    @Body("choice") choice: "existing" | "new"
  ) {
    if (choice !== "existing" && choice !== "new") {
      throw new BadRequestException("choice must be existing or new");
    }

    const conflict = await this.csvService.resolveConflict(id, choice);
    this.gateway.emitConflictResolved(conflict);

    const records = await this.csvService.listRecords("", 1, 20);
    this.gateway.emitRecordsChanged({
      records: records.data,
      reason: "conflict-resolution"
    });

    return conflict;
  }
}
