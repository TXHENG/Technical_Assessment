# CSV Collaboration Assessment

Monorepo implementation for the technical assessment. It contains a React TypeScript frontend and a NestJS TypeScript backend with PostgreSQL persistence, CSV upload validation, pagination/search, and real-time conflict collaboration through Socket.IO.

## Features

- Upload CSV files with browser upload progress feedback.
- Store uploaded rows in PostgreSQL.
- List uploaded records with pagination.
- Search across `id`, `name`, `email`, and `body`.
- Validate CSV structure, required fields, empty files, and duplicate IDs inside one upload.
- Detect overlapping uploads by the unique `id` column.
- Broadcast uploads, record changes, and conflict resolution to all connected browser sessions.
- Show a live diff UI for conflicts and allow users to keep the existing record or accept the incoming version.
- Unit tests for backend CSV edge cases and frontend core rendering.

## Project Structure

```text
apps/
  api/  NestJS API, PostgreSQL access, CSV parser, Socket.IO gateway
  web/  React + Vite frontend
data.csv  Sample CSV required by the assessment
docker-compose.yml
```

## Run With Docker Compose

```bash
docker compose up --build
```

Open the app at:

```text
http://localhost:5173
```

The API runs at:

```text
http://localhost:3000
```

## Demo Flow

1. Open `http://localhost:5173` in two browser windows or tabs.
2. Upload the provided `data.csv`.
3. Create a second CSV with the same `id` values but changed `name`, `email`, or `body` values.
4. Upload the changed file from either tab.
5. Both tabs receive the conflict event without a page refresh and show the changed fields.
6. Choose `Keep existing` or `Accept incoming`; the other tab updates within the Socket.IO broadcast window.

## Local Development

Install dependencies:

```bash
npm install
```

Start PostgreSQL:

```bash
docker compose up postgres
```

Run both apps in watch mode:

```bash
npm run dev
```

Useful URLs:

```text
Frontend: http://localhost:5173
Backend health: http://localhost:3000/health
```

## Tests

```bash
npm test
```

Build both workspaces:

```bash
npm run build
```

## Conflict Resolution Strategy

The application treats `id` as the unique identifier because the supplied CSV includes a stable `id` column. During upload, each parsed row is compared with the stored row for the same `id`.

- If no stored row exists, the row is inserted.
- If the stored row is identical, it is skipped as unchanged.
- If fields differ, the API creates a pending conflict containing both snapshots and the changed field list.
- Pending conflicts are emitted to every connected browser session.
- Choosing `Accept incoming` updates the stored row and increments its version.
- Choosing `Keep existing` marks the conflict resolved without changing the stored row.

This keeps ingestion deterministic, makes conflicts auditable, and avoids silently overwriting user-visible data.
