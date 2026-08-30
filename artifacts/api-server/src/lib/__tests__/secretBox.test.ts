import { randomBytes } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signToken, verifyToken } from "../secretBox";

const ENC_ENV = "TEST_ENC_KEY";
const STATE_ENV = "TEST_STATE_SECRET";

beforeEach(() => {
  process.env[ENC_ENV] = randomBytes(32).toString("base64");
  process.env[STATE_ENV] = randomBytes(32).toString("base64url");
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext", () => {
    const ciphertext = encryptSecret("super-secret-refresh-token", ENC_ENV);
    expect(ciphertext).not.toContain("super-secret-refresh-token");
    expect(decryptSecret(ciphertext, ENC_ENV)).toBe("super-secret-refresh-token");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-plaintext", ENC_ENV);
    const b = encryptSecret("same-plaintext", ENC_ENV);
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", () => {
    const ciphertext = encryptSecret("secret", ENC_ENV);
    const [iv, tag, data] = ciphertext.split(".");
    const tampered = [iv, tag, Buffer.from("tampered").toString("base64")].join(".");
    expect(() => decryptSecret(tampered, ENC_ENV)).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    process.env[ENC_ENV] = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("secret", ENC_ENV)).toThrow(/32 bytes/);
  });
});

describe("signToken / verifyToken", () => {
  it("round-trips a payload", () => {
    const token = signToken({ uid: "user-1", verifier: "abc" }, STATE_ENV, 600);
    const claims = verifyToken<{ uid: string; verifier: string }>(token, STATE_ENV);
    expect(claims).toEqual(expect.objectContaining({ uid: "user-1", verifier: "abc" }));
  });

  it("rejects an expired token", () => {
    const token = signToken({ uid: "user-1" }, STATE_ENV, -1);
    expect(verifyToken(token, STATE_ENV)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signToken({ uid: "user-1" }, STATE_ENV, 600);
    const [body, sig] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ uid: "attacker", exp: 9999999999 })).toString("base64url");
    expect(verifyToken(`${forgedBody}.${sig}`, STATE_ENV)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signToken({ uid: "user-1" }, STATE_ENV, 600);
    process.env[STATE_ENV] = randomBytes(32).toString("base64url");
    expect(verifyToken(token, STATE_ENV)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyToken("not-a-token", STATE_ENV)).toBeNull();
  });
});
