import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthMock, queryMock, getUserMock } = vi.hoisted(() => ({
  getAuthMock: vi.fn(),
  queryMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  getAuth: getAuthMock,
  clerkClient: { users: { getUser: getUserMock } },
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: queryMock,
  },
}));

import { clerkIdentityMiddleware, resetClerkLookupCache } from "../clerkIdentityMiddleware.js";
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
    getUserMock.mockReset();
    resetClerkLookupCache();
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
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("creates the app_user from Clerk's API when the token has no email claim and no row exists", async () => {
    getAuthMock.mockReturnValue({ userId: "user_plain_token", sessionClaims: {} });
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "new-app-user" }] });
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: "idn_2",
      emailAddresses: [
        { id: "idn_1", emailAddress: "old@example.com" },
        { id: "idn_2", emailAddress: "primary@example.com" },
      ],
      firstName: "Plain",
      lastName: "Token",
      imageUrl: "https://example.com/plain.png",
    });

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: "user_plain_token",
      appUserId: "new-app-user",
      email: "primary@example.com",
      firstName: "Plain",
      lastName: "Token",
      profileImageUrl: "https://example.com/plain.png",
    });
    expect(getUserMock).toHaveBeenCalledWith("user_plain_token");
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1]?.[0]).toContain("ON CONFLICT (replit_id) DO UPDATE");
    expect(queryMock.mock.calls[1]?.[1]).toEqual([
      "user_plain_token",
      "Plain Token",
      "primary@example.com",
      "user_plain_token",
    ]);
  });

  it("signs in without an app_user, and asks Clerk only once, when the Clerk account has no email", async () => {
    getAuthMock.mockReturnValue({ userId: "user_phone_only", sessionClaims: {} });
    queryMock.mockResolvedValue({ rows: [] });
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: null,
      emailAddresses: [],
      firstName: null,
      lastName: null,
      imageUrl: "",
    });
    const app = makeApp();

    const first = await request(app).get("/auth/user");
    const second = await request(app).get("/auth/user");

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: "user_phone_only", appUserId: null, email: null });
    expect(second.body).toMatchObject({ appUserId: null });
    expect(getUserMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const call of queryMock.mock.calls) {
      expect(call[0]).not.toContain("INSERT");
    }
  });

  it("keeps serving the request when Clerk's API fails", async () => {
    getAuthMock.mockReturnValue({ userId: "user_clerk_down", sessionClaims: {} });
    queryMock.mockResolvedValue({ rows: [] });
    getUserMock.mockRejectedValue(new Error("Clerk API unavailable"));

    const response = await request(makeApp()).get("/auth/user");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "user_clerk_down", appUserId: null });
    expect(queryMock).toHaveBeenCalledOnce();
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