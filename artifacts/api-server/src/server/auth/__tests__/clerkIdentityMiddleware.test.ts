import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthMock, queryMock } = vi.hoisted(() => ({
  getAuthMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: getAuthMock,
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: queryMock,
  },
}));

import { clerkIdentityMiddleware } from "../clerkIdentityMiddleware.js";
import { getCurrentUser } from "../index.js";

function makeApp() {
  const app = express();
  app.use(clerkIdentityMiddleware);
  app.get("/auth/user", (req: Request, res) => {
    res.json(getCurrentUser(req));
  });
  return app;
}

describe("Clerk identity integration", () => {
  beforeEach(() => {
    getAuthMock.mockReset();
    queryMock.mockReset();
  });

  it("returns null and does not touch the database without a valid session", async () => {
    getAuthMock.mockReturnValue({ userId: null, sessionClaims: null });

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("provisions an app_user and returns the signed-in user for a new Clerk account", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_clerk_123",
      sessionClaims: {
        email: "new.player@example.com",
        firstName: "New",
        lastName: "Player",
        imageUrl: "https://example.com/avatar.png",
      },
    });
    queryMock.mockResolvedValue({ rows: [{ id: "app-user-uuid" }] });

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: "user_clerk_123",
      appUserId: "app-user-uuid",
      email: "new.player@example.com",
      firstName: "New",
      lastName: "Player",
      profileImageUrl: "https://example.com/avatar.png",
    });
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0]?.[0]).toContain("ON CONFLICT (replit_id) DO UPDATE");
    expect(queryMock.mock.calls[0]?.[1]).toEqual([
      "user_clerk_123",
      "New Player",
      "new.player@example.com",
      "user_clerk_123",
    ]);
  });

  it("preserves a migrated identity while linking it to the Clerk account", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_clerk_456",
      sessionClaims: {
        userId: "legacy-user-789",
        email: "returning.player@example.com",
        firstName: "Returning",
        lastName: "Player",
      },
    });
    queryMock.mockResolvedValue({ rows: [{ id: "existing-app-user" }] });

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "legacy-user-789",
      appUserId: "existing-app-user",
      email: "returning.player@example.com",
    });
    expect(queryMock.mock.calls[0]?.[1]).toEqual([
      "legacy-user-789",
      "Returning Player",
      "returning.player@example.com",
      "user_clerk_456",
    ]);
  });

  it("uses an idempotent upsert so repeat sign-ins cannot create duplicate users", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_repeat",
      sessionClaims: { email: "repeat@example.com" },
    });
    queryMock.mockResolvedValue({ rows: [{ id: "same-app-user" }] });
    const app = makeApp();

    const first = await request(app).get("/auth/user");
    const second = await request(app).get("/auth/user");

    expect(first.body.appUserId).toBe("same-app-user");
    expect(second.body.appUserId).toBe("same-app-user");
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0]?.[0]).toContain("ON CONFLICT (replit_id)");
    expect(queryMock.mock.calls[1]?.[0]).toContain("ON CONFLICT (replit_id)");
  });

  it("looks up an existing domain user when the session has no email claim", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_without_email",
      sessionClaims: {},
    });
    queryMock.mockResolvedValue({ rows: [{ id: "existing-app-user" }] });

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "user_without_email",
      appUserId: "existing-app-user",
      email: null,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM app_user"),
      ["user_without_email"],
    );
  });

  it("surfaces provisioning failures instead of silently returning a broken identity", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_db_failure",
      sessionClaims: { email: "failure@example.com" },
    });
    queryMock.mockRejectedValue(new Error("database unavailable"));

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(500);
  });
});