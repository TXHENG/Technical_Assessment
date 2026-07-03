export type CsvRecord = {
  id: string;
  postId: string;
  name: string;
  email: string;
  body: string;
  [key: string]: string;
};

export type StoredRecord = {
  id: string;
  postId: string;
  name: string;
  email: string;
  body: string;
  raw: CsvRecord;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ConflictRecord = {
  id: string;
  recordId: string;
  oldRecord: CsvRecord;
  newRecord: CsvRecord;
  changedFields: string[];
  status: "pending" | "kept_existing" | "accepted_new";
  createdAt: string;
  resolvedAt: string | null;
};

export type ImportSummary = {
  uploadId: string;
  inserted: number;
  conflicts: ConflictRecord[];
  skipped: number;
  totalRows: number;
};
