/**
 * Verifies the FRONTEND_DIST_DIR-gated static-serving + OG-injection block
 * in app.ts. Since it's read at module-load time, each scenario needs its
 * own fresh import of app.ts (vi.resetModules) with the env var set first.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import request from "supertest";
import { pool } from "@workspace/db";

const RUN_ID = crypto.randomBytes(4).toString("hex");
let distDir: string;
let schemaReady = false;

const INDEX_HTML = `<!DOCTYPE html>
<html><head>
<title>Front Office</title>
<meta name="description" content="Front Office — built on Replit." />
<meta property="og:title" content="Front Office" />
<meta property="og:description" content="Front Office — built on Replit." />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Front Office" />
<meta name="twitter:description" content="Front Office — built on Replit." />
</head><body><div id="root"></div></body></html>
`;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'league' AND column_name = 'public_code') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;

  distDir = mkdtempSync(path.join(tmpdir(), "fo-dist-"));
  writeFileSync(path.join(distDir, "index.html"), INDEX_HTML);
  process.env.FRONTEND_DIST_DIR = distDir;
});

afterAll(() => {
  delete process.env.FRONTEND_DIST_DIR;
  rmSync(distDir, { recursive: true, force: true });
});

async function freshApp() {
  vi.resetModules();
  const { default: app } = await import("../app.js");
  return app;
}

describe("frontend serving + OG injection (FRONTEND_DIST_DIR set)", () => {
  it("injects real OG tags for a public league's page", async () => {
    if (!schemaReady) return;
    const app = await freshApp();

    const [owner] = await pool.query<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`og-owner-${RUN_ID}`, `OG Owner ${RUN_ID}`, `og-owner-${RUN_ID}@test.invalid`],
    ).then(r => r.rows);
    const [league] = await pool.query<{ id: string }>(
      `INSERT INTO league (owner_user_id, name, slug, visibility, logo_url) VALUES ($1,$2,$3,'public',$4) RETURNING id`,
      [owner!.id, `OG Public League ${RUN_ID}`, `og-public-${RUN_ID}`, "https://cdn.example/logo.png"],
    ).then(r => r.rows);

    const res = await request(app).get(`/l/og-public-${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<title>OG Public League ${RUN_ID} — Front Office</title>`);
    expect(res.text).toContain('property="og:image" content="https://cdn.example/logo.png"');
  });

  it("does not leak a private league's name into the OG tags", async () => {
    if (!schemaReady) return;
    const app = await freshApp();

    const [owner] = await pool.query<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`og-priv-owner-${RUN_ID}`, `OG Priv Owner ${RUN_ID}`, `og-priv-owner-${RUN_ID}@test.invalid`],
    ).then(r => r.rows);
    await pool.query(
      `INSERT INTO league (owner_user_id, name, slug, visibility) VALUES ($1,$2,$3,'private')`,
      [owner!.id, `Super Secret League ${RUN_ID}`, `og-private-${RUN_ID}`],
    );

    const res = await request(app).get(`/l/og-private-${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Super Secret League");
    expect(res.text).toContain("<title>Front Office</title>");
  });

  it("an unlisted league only gets real tags when the code query param matches", async () => {
    if (!schemaReady) return;
    const app = await freshApp();

    const [owner] = await pool.query<{ id: string }>(
      `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [`og-unl-owner-${RUN_ID}`, `OG Unl Owner ${RUN_ID}`, `og-unl-owner-${RUN_ID}@test.invalid`],
    ).then(r => r.rows);
    await pool.query(
      `INSERT INTO league (owner_user_id, name, slug, visibility, public_code) VALUES ($1,$2,$3,'unlisted',$4)`,
      [owner!.id, `Unlisted League ${RUN_ID}`, `og-unlisted-${RUN_ID}`, `CODE${RUN_ID.toUpperCase()}`],
    );

    const noCode = await request(app).get(`/l/og-unlisted-${RUN_ID}`);
    expect(noCode.text).not.toContain("Unlisted League");

    const withCode = await request(app).get(`/l/og-unlisted-${RUN_ID}?code=CODE${RUN_ID.toUpperCase()}`);
    expect(withCode.text).toContain(`Unlisted League ${RUN_ID}`);
  });

  it("falls back to serving index.html for a client-side SPA route", async () => {
    if (!schemaReady) return;
    const app = await freshApp();
    const res = await request(app).get("/leagues/open");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root"></div>');
  });
});
