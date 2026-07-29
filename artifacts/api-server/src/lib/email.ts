/**
 * Minimal email utility for transactional messages.
 *
 * When SMTP_HOST is configured the message is delivered via nodemailer.
 * In development (or when SMTP is absent) the reset link is printed to the
 * server console so the flow can be exercised without a mail server.
 */
import nodemailer from 'nodemailer';

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
      : undefined,
  });
}

const FROM = process.env.SMTP_FROM ?? 'Front Office <noreply@frontoffice.app>';

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  const { to, resetUrl } = opts;

  const transport = getTransport();
  if (transport) {
    await transport.sendMail({
      from: FROM,
      to,
      subject: 'Reset your Front Office password',
      text: [
        'You (or someone who knows your email) requested a password reset.',
        '',
        'Click the link below within 1 hour to set a new password:',
        resetUrl,
        '',
        'If you did not request this, ignore this email — your password will not change.',
      ].join('\n'),
      html: `
        <p>You (or someone who knows your email) requested a password reset.</p>
        <p><a href="${resetUrl}" style="color:#1a6db5">Reset your password</a></p>
        <p style="color:#666;font-size:13px">
          This link expires in 1&nbsp;hour. If you did not request this, ignore
          this email — your password will not change.
        </p>
      `,
    });
  } else {
    // Dev / no-SMTP fallback — print to console so the flow is testable
    console.log(`[password-reset] SMTP not configured. Reset URL for ${to}:`);
    console.log(`[password-reset] ${resetUrl}`);
  }
}
