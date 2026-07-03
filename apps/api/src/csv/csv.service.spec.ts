import { BadRequestException } from "@nestjs/common";
import { CsvService } from "./csv.service";

const rowOne = '"postId","id","name","email","body"\n"1","1","Alpha","a@example.com","Hello"';

function makeDb(existingRows: Map<string, any> = new Map()) {
  const conflicts: any[] = [];
  const inserted: any[] = [];

  return {
    inserted,
    conflicts,
    transaction: async (callback: any) =>
      callback({
        query: async (sql: string, params: any[]) => {
          if (sql.includes("select * from records where id")) {
            return { rows: existingRows.has(params[0]) ? [existingRows.get(params[0])] : [] };
          }
          if (sql.includes("insert into records")) {
            inserted.push(params);
            return { rows: [] };
          }
          if (sql.includes("insert into conflicts")) {
            const row = {
              id: params[0],
              record_id: params[1],
              old_record: params[2],
              new_record: params[3],
              changed_fields: params[4],
              status: "pending",
              created_at: new Date("2026-01-01T00:00:00Z"),
              resolved_at: null
            };
            conflicts.push(row);
            return { rows: [row] };
          }
          return { rows: [] };
        }
      })
  };
}

describe("CsvService", () => {
  it("inserts valid records", async () => {
    const db = makeDb();
    const service = new CsvService(db as any);

    const result = await service.importCsv(Buffer.from(rowOne));

    expect(result.inserted).toBe(1);
    expect(result.conflicts).toHaveLength(0);
    expect(db.inserted[0][0]).toBe("1");
  });

  it("detects changed duplicate records as conflicts", async () => {
    const existing = new Map([
      [
        "1",
        {
          id: "1",
          post_id: "1",
          name: "Alpha",
          email: "a@example.com",
          body: "Old body",
          raw: {
            postId: "1",
            id: "1",
            name: "Alpha",
            email: "a@example.com",
            body: "Old body"
          },
          version: 1,
          created_at: new Date("2026-01-01T00:00:00Z"),
          updated_at: new Date("2026-01-01T00:00:00Z")
        }
      ]
    ]);
    const db = makeDb(existing);
    const service = new CsvService(db as any);

    const result = await service.importCsv(Buffer.from(rowOne));

    expect(result.inserted).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].changedFields).toContain("body");
  });

  it("rejects duplicate ids inside the same upload", async () => {
    const service = new CsvService(makeDb() as any);

    await expect(
      service.importCsv(Buffer.from(`${rowOne}\n"1","1","Beta","b@example.com","Body"`))
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects missing required columns", async () => {
    const service = new CsvService(makeDb() as any);

    await expect(
      service.importCsv(Buffer.from('"id","name"\n"1","Alpha"'))
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("normalizes escaped newline sequences in body text", async () => {
    const db = makeDb();
    const service = new CsvService(db as any);

    await service.importCsv(
      Buffer.from('"postId","id","name","email","body"\n"1","1","Alpha","a@example.com","First\\nSecond"')
    );

    expect(db.inserted[0][4]).toBe("First\nSecond");
  });
});
