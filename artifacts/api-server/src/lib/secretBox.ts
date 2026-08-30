/**
 * AES-256-GCM at-rest encryption and HMAC-signed, self-contained tokens.
 *
 * Used by the Xbox verification flow to (a) sign OAuth `state` so the
 * callback can trust it without server-side session storage, and (b) encrypt
 * the Microsoft refresh token before it touches the database.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";

function loadKey(envVar: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(`${envVar} environment variable is required but was not provided.`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${envVar} must decode (base64) to exactly 32 bytes; got ${key.length}.`);
  }
  return key;
}

export function encryptSecret(plaintext: string, envVar: string): string {
  const key = loadKey(envVar);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(encoded: string, envVar: string): string {
  const key = loadKey(envVar);
  const [ivB64, tagB64, dataB64] = encoded.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed ciphertext");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Signs a JSON payload into a compact, URL-safe token: base64url(payload).base64url(hmac).
 * Verification checks both the signature and an embedded expiry — no server-side
 * storage needed, which is what lets the OAuth `state` param double as the PKCE
 * verifier carrier across a redirect to a third party and back.
 */
export function signToken(payload: Record<string, unknown>, envVar: string, ttlSeconds: number): string {
  const key = loadKeyRaw(envVar);
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const bodyB64 = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const sig = createHmac("sha256", key).update(bodyB64).digest("base64url");
  return `${bodyB64}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string, envVar: string): T | null {
  const key = loadKeyRaw(envVar);
  const [bodyB64, sig] = token.split(".");
  if (!bodyB64 || !sig) return null;
  const expectedSig = createHmac("sha256", key).update(bodyB64).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  let body: T & { exp?: number };
  try {
    body = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return body;
}

function loadKeyRaw(envVar: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(`${envVar} environment variable is required but was not provided.`);
  }
  return Buffer.from(raw, "utf8");
}
