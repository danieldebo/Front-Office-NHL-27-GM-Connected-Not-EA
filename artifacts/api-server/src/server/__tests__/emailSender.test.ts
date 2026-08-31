import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendEmail } from "../emailSender";
import { PermanentDeliveryError } from "../discordWebhook";

const ORIGINAL_ENV = { ...process.env };

describe("sendEmail", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("throws PermanentDeliveryError when no provider is configured", async () => {
    delete process.env.EMAIL_API_BASE;
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;

    await expect(sendEmail({ to: "gm@test.invalid", subject: "hi", text: "body" })).rejects.toBeInstanceOf(
      PermanentDeliveryError,
    );
  });

  it("posts to the configured provider when env vars are set", async () => {
    process.env.EMAIL_API_BASE = "https://email.example/send";
    process.env.EMAIL_API_KEY = "test-key";
    process.env.EMAIL_FROM_ADDRESS = "digest@example.com";

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({ to: "gm@test.invalid", subject: "hi", text: "body" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://email.example/send",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("treats a 4xx response as a permanent failure", async () => {
    process.env.EMAIL_API_BASE = "https://email.example/send";
    process.env.EMAIL_API_KEY = "test-key";
    process.env.EMAIL_FROM_ADDRESS = "digest@example.com";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad request" }));

    await expect(sendEmail({ to: "gm@test.invalid", subject: "hi", text: "body" })).rejects.toBeInstanceOf(
      PermanentDeliveryError,
    );
  });
});
