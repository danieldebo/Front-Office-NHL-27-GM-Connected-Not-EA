/**
 * Outbound email — same "documented gap" honesty as nhlApi.ts: this sandbox
 * has no email provider credentials (no SMTP host, no SendGrid/Resend/
 * Postmark API key — see .env.example), so sendEmail() has never been
 * exercised against a live provider. It's written against the generic
 * transactional-email REST shape most providers share (POST a JSON body of
 * {from, to, subject, text} to a base URL with a Bearer key) so wiring a
 * real provider later is a matter of setting EMAIL_API_BASE/EMAIL_API_KEY/
 * EMAIL_FROM_ADDRESS, not rewriting this file.
 *
 * When those env vars are unset, sendEmail throws PermanentDeliveryError
 * immediately — the outbox worker marks the row processed (not retried)
 * rather than looping forever on a delivery path that can never succeed in
 * this environment.
 */
import { PermanentDeliveryError } from "./discordWebhook";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const base = process.env.EMAIL_API_BASE;
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;

  if (!base || !apiKey || !from) {
    throw new PermanentDeliveryError(
      "No email provider configured (EMAIL_API_BASE / EMAIL_API_KEY / EMAIL_FROM_ADDRESS) — see .env.example"
    );
  }

  const res = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`Email provider transient failure (${res.status}): ${body}`);
    }
    throw new PermanentDeliveryError(`Email provider rejected the message (${res.status}): ${body}`);
  }
}
