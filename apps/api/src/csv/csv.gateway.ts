import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server } from "socket.io";
import { ConflictRecord, ImportSummary, StoredRecord } from "./csv.types";

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:5173"],
    credentials: true
  }
})
export class CsvGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage("dataset:focus")
  focus(@MessageBody() body: { query?: string }) {
    return { ok: true, query: body?.query ?? "" };
  }

  emitImport(summary: ImportSummary) {
    this.server.emit("import:completed", summary);
  }

  emitRecordsChanged(payload: { records: StoredRecord[]; reason: string }) {
    this.server.emit("records:changed", payload);
  }

  emitConflictResolved(conflict: ConflictRecord) {
    this.server.emit("conflict:resolved", conflict);
  }
}
