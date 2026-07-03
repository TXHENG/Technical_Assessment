import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://csv_user:csv_password@localhost:5432/csv_collab"
  });

  async onModuleInit() {
    await this.query(`
      create table if not exists records (
        id text primary key,
        post_id text,
        name text not null,
        email text not null,
        body text not null,
        raw jsonb not null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await this.query(`
      create table if not exists conflicts (
        id uuid primary key,
        record_id text not null,
        old_record jsonb not null,
        new_record jsonb not null,
        changed_fields jsonb not null,
        status text not null default 'pending',
        created_at timestamptz not null default now(),
        resolved_at timestamptz
      );
    `);

    await this.query("create index if not exists records_search_idx on records using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(body,'')));");
    await this.query("create index if not exists conflicts_status_idx on conflicts(status, created_at desc);");
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await callback(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
