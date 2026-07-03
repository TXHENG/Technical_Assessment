import { ConflictRecord, ImportSummary, PagedRecords } from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(Array.isArray(body.message) ? body.message.join(", ") : body.message);
  }

  return response.json() as Promise<T>;
}

export function fetchRecords(query: string, page: number, pageSize: number) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize)
  });
  return request<PagedRecords>(`/records?${params}`);
}

export function fetchConflicts() {
  return request<ConflictRecord[]>("/conflicts");
}

export function resolveConflict(id: string, choice: "existing" | "new") {
  return request<ConflictRecord>(`/conflicts/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ choice })
  });
}

export function uploadCsv(
  file: File,
  onProgress: (progress: number) => void
): Promise<ImportSummary> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/uploads`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body);
        } else {
          reject(new Error(Array.isArray(body.message) ? body.message.join(", ") : body.message));
        }
      } catch {
        reject(new Error("Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}
