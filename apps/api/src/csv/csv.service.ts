import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { ConflictRecord, CsvRecord, ImportSummary, StoredRecord } from "./csv.types";

const REQUIRED_HEADERS = ["id", "postId", "name", "email", "body"];

type RecordRow = {
  id: string;
  post_id: string;
  name: string;
  email: string;
  body: string;
  raw: CsvRecord;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type ConflictRow = {
  id: string;
  record_id: string;
  old_record: CsvRecord;
  new_record: CsvRecord;
  changed_fields: string[];
  status: "pending" | "kept_existing" | "accepted_new";
  created_at: Date;
  resolved_at: Date | null;
};

@Injectable()
export class CsvService {
  constructor(private readonly db: DatabaseService) {}

  async importCsv(buffer: Buffer): Promise<ImportSummary> {
    const records = this.parseCsv(buffer);
    const uploadId = randomUUID();

    return this.db.transaction(async (client) => {
      let inserted = 0;
      let skipped = 0;
      const conflicts: ConflictRecord[] = [];

      for (const record of records) {
        const existing = await this.findRecordById(client, record.id);
        if (!existing) {
          await this.insertRecord(client, record);
          inserted += 1;
          continue;
        }

        const changedFields = diffFields(existing.raw, record);
        if (changedFields.length === 0) {
          skipped += 1;
          continue;
        }

        const conflict = await this.insertConflict(
          client,
          existing.id,
          existing.raw,
          record,
          changedFields
        );
        conflicts.push(toConflict(conflict));
      }

      return {
        uploadId,
        inserted,
        skipped,
        conflicts,
        totalRows: records.length
      };
    });
  }

  async listRecords(query: string, page: number, pageSize: number) {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    const offset = (safePage - 1) * safePageSize;
    const values: unknown[] = [];
    const where = query.trim()
      ? `where id ilike $1 or name ilike $1 or email ilike $1 or body ilike $1`
      : "";

    if (where) {
      values.push(`%${query.trim()}%`);
    }

    const count = await this.db.query<{ total: string }>(
      `select count(*) as total from records ${where}`,
      values
    );
    const rows = await this.db.query<RecordRow>(
      `
      select * from records
      ${where}
      order by (id ~ '^[0-9]+$') desc, case when id ~ '^[0-9]+$' then id::int end asc, id asc
      limit $${values.length + 1} offset $${values.length + 2}
      `,
      [...values, safePageSize, offset]
    );

    return {
      data: rows.rows.map(toRecord),
      page: safePage,
      pageSize: safePageSize,
      total: Number(count.rows[0]?.total ?? 0)
    };
  }

  async listConflicts() {
    const rows = await this.db.query<ConflictRow>(
      "select * from conflicts where status = 'pending' order by created_at desc"
    );
    return rows.rows.map(toConflict);
  }

  async resolveConflict(conflictId: string, choice: "existing" | "new") {
    return this.db.transaction(async (client) => {
      const conflictResult = await client.query<ConflictRow>(
        "select * from conflicts where id = $1 for update",
        [conflictId]
      );
      const conflict = conflictResult.rows[0];
      if (!conflict) {
        throw new NotFoundException("Conflict not found");
      }
      if (conflict.status !== "pending") {
        return toConflict(conflict);
      }

      if (choice === "new") {
        await client.query(
          `
          update records
          set post_id = $2, name = $3, email = $4, body = $5, raw = $6, version = version + 1, updated_at = now()
          where id = $1
          `,
          [
            conflict.record_id,
            conflict.new_record.postId,
            conflict.new_record.name,
            conflict.new_record.email,
            conflict.new_record.body,
            conflict.new_record
          ]
        );
      }

      const updated = await client.query<ConflictRow>(
        `
        update conflicts
        set status = $2, resolved_at = now()
        where id = $1
        returning *
        `,
        [conflictId, choice === "new" ? "accepted_new" : "kept_existing"]
      );

      return toConflict(updated.rows[0]);
    });
  }

  private parseCsv(buffer: Buffer): CsvRecord[] {
    if (!buffer.byteLength) {
      throw new BadRequestException("CSV file is empty");
    }

    let rows: Record<string, string>[];
    try {
      rows = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
      });
    } catch {
      throw new BadRequestException("CSV file could not be parsed");
    }

    if (rows.length === 0) {
      throw new BadRequestException("CSV must contain at least one data row");
    }

    const headers = Object.keys(rows[0] ?? {});
    const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
    if (missing.length > 0) {
      throw new BadRequestException(`CSV is missing required column(s): ${missing.join(", ")}`);
    }

    const seen = new Set<string>();
    return rows.map((row, index) => {
      const line = index + 2;
      for (const header of REQUIRED_HEADERS) {
        if (!row[header]?.trim()) {
          throw new BadRequestException(`Row ${line} is missing ${header}`);
        }
      }
      if (seen.has(row.id)) {
        throw new BadRequestException(`CSV contains duplicate id ${row.id}`);
      }
      seen.add(row.id);

      return {
        ...row,
        id: row.id.trim(),
        postId: row.postId.trim(),
        name: row.name.trim(),
        email: row.email.trim(),
        body: normalizeBody(row.body)
      };
    });
  }

  private async findRecordById(client: PoolClient, id: string) {
    const result = await client.query<RecordRow>("select * from records where id = $1", [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  private async insertRecord(client: PoolClient, record: CsvRecord) {
    await client.query(
      `
      insert into records (id, post_id, name, email, body, raw)
      values ($1, $2, $3, $4, $5, $6)
      `,
      [record.id, record.postId, record.name, record.email, record.body, record]
    );
  }

  private async insertConflict(
    client: PoolClient,
    recordId: string,
    oldRecord: CsvRecord,
    newRecord: CsvRecord,
    changedFields: string[]
  ) {
    const result = await client.query<ConflictRow>(
      `
      insert into conflicts (id, record_id, old_record, new_record, changed_fields)
      values ($1, $2, $3, $4, $5)
      returning *
      `,
      [randomUUID(), recordId, oldRecord, newRecord, changedFields]
    );
    return result.rows[0];
  }
}

function diffFields(oldRecord: CsvRecord, newRecord: CsvRecord) {
  const keys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);
  return [...keys].filter((key) => (oldRecord[key] ?? "") !== (newRecord[key] ?? ""));
}

function normalizeBody(value: string) {
  return value.trim().replace(/\\r\\n|\\n|\\r/g, "\n");
}

function toRecord(row: RecordRow): StoredRecord {
  return {
    id: row.id,
    postId: row.post_id,
    name: row.name,
    email: row.email,
    body: row.body,
    raw: row.raw,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toConflict(row: ConflictRow): ConflictRecord {
  return {
    id: row.id,
    recordId: row.record_id,
    oldRecord: row.old_record,
    newRecord: row.new_record,
    changedFields: row.changed_fields,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}
