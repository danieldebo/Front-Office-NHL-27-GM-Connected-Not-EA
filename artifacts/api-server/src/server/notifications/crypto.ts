import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to encrypt Discord webhooks");
  return createHash("sha256").update(`front-office:discord:${secret}`).digest();
}

export function encryptWebhookUrl(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptWebhookUrl(secret: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), secret.iv);
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([
    decipher.update(secret.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function maskWebhookUrl(): string {
  // Deliberately reveal neither webhook id nor token.
  return "https://discord.com/api/webhooks/••••••••/••••••••";
}