import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, warnMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: queryMock,
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    warn: warnMock,
  },
}));

import {
  livenessHandler,
  readinessHandler,
} from "../health.js";

function makeApp() {
  const app = express();
  app.get("/livez", livenessHandler);
  app.get("/readyz", readinessHandler);
  return app;
}

describe("health routes", () => {
  beforeEach(() => {
    queryMock.mockReset();
    warnMock.mockReset();
  });

  it("reports liveness without querying dependencies", async () => {
    const response = await request(makeApp()).get("/livez");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("reports readiness from required schema structures without ledger data", async () => {
    queryMock.mockResolvedValue({ rows: [{ ready: true }] });

    const response = await request(makeApp()).get("/readyz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(queryMock).toHaveBeenCalledOnce();
    const readinessSql = queryMock.mock.calls[0]?.[0] as string;
    expect(readinessSql).toContain("notification_delivery_job");
    expect(readinessSql).toContain("v_open_leagues");
    expect(readinessSql).toContain("dead_lettered_at");
    expect(readinessSql).not.toContain("schema_version");
  });

  it("returns unavailable when required schema structures are missing", async () => {
    queryMock.mockResolvedValue({ rows: [{ ready: false }] });

    const response = await request(makeApp()).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "unavailable" });
  });

  it("returns unavailable when the database check fails", async () => {
    queryMock.mockRejectedValue(new Error("database unavailable"));

    const response = await request(makeApp()).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "unavailable" });
    expect(warnMock).toHaveBeenCalledOnce();
  });
});