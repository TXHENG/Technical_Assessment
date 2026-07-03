import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: vi.fn(),
    close: vi.fn()
  })
}));

vi.mock("./api", () => ({
  API_URL: "http://localhost:3000",
  fetchRecords: vi.fn(async () => ({
    data: [],
    page: 1,
    pageSize: 20,
    total: 0
  })),
  fetchConflicts: vi.fn(async () => []),
  resolveConflict: vi.fn(),
  uploadCsv: vi.fn()
}));

describe("App", () => {
  it("renders upload, search, and conflict regions", async () => {
    render(<App />);

    expect(screen.getByText("Upload, search, and resolve live record conflicts")).not.toBeNull();
    expect(screen.getByLabelText("CSV file")).not.toBeNull();
    expect(screen.getByLabelText("Search records")).not.toBeNull();
    expect(await screen.findByText("No records found")).not.toBeNull();
  });
});
