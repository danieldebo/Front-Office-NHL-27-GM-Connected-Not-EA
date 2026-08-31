import { describe, expect, it, vi } from "vitest";
import {
  discordBackoffMs, isRetryableStatus, outboxRetryMs, shouldDeadLetterOutbox,
} from "../../notifications/domainEvents";

describe("notification delivery retry policy", () => {
  it("honors Discord numeric Retry-After", () => {
    expect(discordBackoffMs(8, "2.5")).toBe(2_500);
  });

  it("uses bounded exponential backoff", () => {
    expect(discordBackoffMs(0)).toBe(1_000);
    expect(discordBackoffMs(3)).toBe(8_000);
    expect(discordBackoffMs(99)).toBe(3_600_000);
  });

  it("honors HTTP-date Retry-After", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(discordBackoffMs(0, "Thu, 01 Jan 2026 00:00:03 GMT")).toBe(3_000);
    vi.useRealTimers();
  });

  it("retries throttling and server failures, not hard client failures", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it("bounds poison outbox retries and dead-letters at the cap", () => {
    expect(outboxRetryMs(1)).toBe(2_000);
    expect(outboxRetryMs(99)).toBe(3_600_000);
    expect(shouldDeadLetterOutbox(9)).toBe(false);
    expect(shouldDeadLetterOutbox(10)).toBe(true);
  });
});