import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  API_URL,
  fetchConflicts,
  fetchRecords,
  resolveConflict,
  uploadCsv
} from "./api";
import { ConflictRecord, ImportSummary, PagedRecords } from "./types";

const SEARCH_DEBOUNCE_MS = 350;

const emptyPage: PagedRecords = {
  data: [],
  page: 1,
  pageSize: 20,
  total: 0
};

export function App() {
  const [records, setRecords] = useState<PagedRecords>(emptyPage);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("Ready for CSV upload");
  const [error, setError] = useState("");

  const totalPages = Math.max(Math.ceil(records.total / records.pageSize), 1);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchRecords(debouncedQuery, page, 20);
      setRecords(result);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load records");
    } finally {
      setIsLoading(false);
    }
  }, [debouncedQuery, page]);

  const loadConflicts = useCallback(async () => {
    try {
      setConflicts(await fetchConflicts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conflicts");
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    void loadConflicts();
  }, [loadConflicts]);

  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket"] });

    socket.on("connect", () => setMessage("Live collaboration connected"));
    socket.on("disconnect", () => setMessage("Live collaboration reconnecting..."));
    socket.on("import:completed", (summary: ImportSummary) => {
      setMessage(
        `Upload complete: ${summary.inserted} inserted, ${summary.conflicts.length} conflict(s), ${summary.skipped} unchanged`
      );
      setConflicts((current) => mergeConflicts(summary.conflicts, current));
      void loadRecords();
    });
    socket.on("records:changed", () => {
      void loadRecords();
    });
    socket.on("conflict:resolved", (conflict: ConflictRecord) => {
      setConflicts((current) => current.filter((item) => item.id !== conflict.id));
      void loadRecords();
    });

    return () => {
      socket.close();
    };
  }, [loadRecords]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file before uploading");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError("");
    setMessage(`Uploading ${file.name}`);

    try {
      const summary = await uploadCsv(file, setUploadProgress);
      setMessage(
        `Processed ${summary.totalRows} rows: ${summary.inserted} inserted, ${summary.conflicts.length} conflict(s), ${summary.skipped} unchanged`
      );
      setConflicts((current) => mergeConflicts(summary.conflicts, current));
      setPage(1);
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleResolve(conflict: ConflictRecord, choice: "existing" | "new") {
    setError("");
    try {
      await resolveConflict(conflict.id, choice);
      setConflicts((current) => current.filter((item) => item.id !== conflict.id));
      setMessage(choice === "new" ? `Accepted update for #${conflict.recordId}` : `Kept existing #${conflict.recordId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve conflict");
    }
  }

  const rangeLabel = useMemo(() => {
    if (records.total === 0) return "0 records";
    const start = (records.page - 1) * records.pageSize + 1;
    const end = Math.min(records.page * records.pageSize, records.total);
    return `${start}-${end} of ${records.total}`;
  }, [records]);

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Application status">
        <div>
          <p className="eyebrow">CSV Collaboration Console</p>
          <h1>Upload, search, and resolve live record conflicts</h1>
        </div>
        <div className="live-pill">
          <span aria-hidden="true" />
          {message}
        </div>
      </section>

      {error ? <div className="alert">{error}</div> : null}

      <section className="workspace">
        <aside className="control-panel" aria-label="Upload controls">
          <form onSubmit={handleUpload} className="upload-form">
            <label htmlFor="file">CSV file</label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" disabled={uploading} />
            <button type="submit" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload CSV"}
            </button>
            <div className="progress-track" aria-label="Upload progress">
              <div style={{ width: `${uploadProgress}%` }} />
            </div>
          </form>

          <div className="metric-grid">
            <div>
              <strong>{records.total}</strong>
              <span>Records</span>
            </div>
            <div>
              <strong>{conflicts.length}</strong>
              <span>Pending conflicts</span>
            </div>
          </div>
        </aside>

        <section className="data-panel" aria-label="Uploaded records">
          <div className="table-toolbar">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setDebouncedQuery(query);
              }}
              className="search-form"
            >
              <label htmlFor="query">Search records</label>
              <input
                id="query"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search id, name, email, or body"
              />
            </form>
            <span className="range">{rangeLabel}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Post</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Body</th>
                  <th>Version</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">Loading records...</td>
                  </tr>
                ) : records.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">No records found</td>
                  </tr>
                ) : (
                  records.data.map((record) => (
                    <tr key={record.id}>
                      <td>{record.id}</td>
                      <td>{record.postId}</td>
                      <td>{record.name}</td>
                      <td>{record.email}</td>
                      <td className="body-cell">{displayText(record.body)}</td>
                      <td>{record.version}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
              Next
            </button>
          </div>
        </section>
      </section>

      <section className="conflict-panel" aria-label="Conflict diff">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Real-time diff</p>
            <h2>Pending conflicts</h2>
          </div>
          <button onClick={() => void loadConflicts()}>Refresh</button>
        </div>

        {conflicts.length === 0 ? (
          <div className="empty-state">Conflicts from overlapping uploads will appear here in every open browser session.</div>
        ) : (
          <div className="conflict-list">
            {conflicts.map((conflict) => (
              <article className="conflict-card" key={conflict.id}>
                <header>
                  <strong>Record #{conflict.recordId}</strong>
                  <span>{conflict.changedFields.length} changed field(s)</span>
                </header>
                <div className="diff-grid">
                  {conflict.changedFields.map((field) => (
                    <div className="diff-row" key={field}>
                      <span className="field-name">{field}</span>
                      <div>
                        <small>Existing</small>
                        <p>{displayText(conflict.oldRecord[field]) || "Empty"}</p>
                      </div>
                      <div>
                        <small>Incoming</small>
                        <p>{displayText(conflict.newRecord[field]) || "Empty"}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <footer>
                  <button onClick={() => void handleResolve(conflict, "existing")}>Keep existing</button>
                  <button className="primary" onClick={() => void handleResolve(conflict, "new")}>Accept incoming</button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function mergeConflicts(next: ConflictRecord[], current: ConflictRecord[]) {
  const byId = new Map(current.map((conflict) => [conflict.id, conflict]));
  for (const conflict of next) {
    byId.set(conflict.id, conflict);
  }
  return [...byId.values()].filter((conflict) => conflict.status === "pending");
}

function displayText(value = "") {
  return value.replace(/\\r\\n|\\n|\\r/g, "\n");
}
