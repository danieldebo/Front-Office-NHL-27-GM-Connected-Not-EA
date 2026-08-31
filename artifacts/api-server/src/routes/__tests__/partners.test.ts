import { vi, describe, it, expect, beforeAll } from "vitest";

vi.mock("../../server/auth/index.js", () => ({
  getCurrentUser: vi.fn().mockReturnValue(null),
}));

import request from "supertest";
import crypto from "crypto";
import { pool } from "@workspace/db";
import app from "../../app.js";
import { getCurrentUser } from "../../server/auth/index.js";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const RUN_ID = crypto.randomBytes(4).toString("hex");

async function sql<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

function authAs(replitId: string, appUserId: string) {
  mockGetCurrentUser.mockReturnValue({ id: replitId, appUserId, name: replitId } as any);
}

let schemaReady = false;
let leagueId: string;
let commissionerReplitId: string;
let commissionerAppUserId: string;
let strangerReplitId: string;
let strangerAppUserId: string;

beforeAll(async () => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'league_partner') AS exists`,
  );
  schemaReady = rows[0]?.exists ?? false;
  if (!schemaReady) return;

  commissionerReplitId = `part-comm-${RUN_ID}`;
  strangerReplitId = `part-stranger-${RUN_ID}`;

  const [comm] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerReplitId, `Partner Comm ${RUN_ID}`, `${commissionerReplitId}@test.invalid`],
  );
  const [stranger] = await sql<{ id: string }>(
    `INSERT INTO app_user (replit_id, display_name, email) VALUES ($1,$2,$3) RETURNING id`,
    [strangerReplitId, `Partner Stranger ${RUN_ID}`, `${strangerReplitId}@test.invalid`],
  );
  commissionerAppUserId = comm!.id;
  strangerAppUserId = stranger!.id;

  const [league] = await sql<{ id: string }>(
    `INSERT INTO league (owner_user_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
    [commissionerAppUserId, `Partner League ${RUN_ID}`, `partner-league-${RUN_ID}`],
  );
  leagueId = league!.id;
});

describe("charity/sponsor partner fields", () => {
  it("starts empty and only the commissioner can write", async () => {
    if (!schemaReady) return;
    const getRes = await request(app).get(`/api/leagues/${leagueId}/partners`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ charities: [], sponsors: [] });

    authAs(strangerReplitId, strangerAppUserId);
    const forbiddenRes = await request(app)
      .put(`/api/leagues/${leagueId}/partners`)
      .send({ charities: [], sponsors: [] });
    expect(forbiddenRes.status).toBe(403);
  });

  it("commissioner can set up to 2 of each, and a 3rd is rejected", async () => {
    if (!schemaReady) return;
    authAs(commissionerReplitId, commissionerAppUserId);

    const okRes = await request(app)
      .put(`/api/leagues/${leagueId}/partners`)
      .send({
        charities: [
          { name: "Local Food Bank", link: "https://example.org/foodbank", blurb: "Feeding neighbors." },
        ],
        sponsors: [
          { name: "Rusty's Pizza", link: "https://example.org/rustys" },
          { name: "Ice Rink Co", link: "https://example.org/rink", logo_url: "https://cdn.example/rink.png" },
        ],
      });
    expect(okRes.status).toBe(200);
    expect(okRes.body.charities).toHaveLength(1);
    expect(okRes.body.sponsors).toHaveLength(2);
    expect(okRes.body.sponsors[1].logo_url).toBe("https://cdn.example/rink.png");

    const tooManyRes = await request(app)
      .put(`/api/leagues/${leagueId}/partners`)
      .send({
        charities: [
          { name: "A", link: "https://a.example" },
          { name: "B", link: "https://b.example" },
          { name: "C", link: "https://c.example" },
        ],
        sponsors: [],
      });
    expect(tooManyRes.status).toBe(400);

    // Replace-all: a second valid PUT fully replaces the first
    const replaceRes = await request(app)
      .put(`/api/leagues/${leagueId}/partners`)
      .send({ charities: [], sponsors: [{ name: "New Sponsor", link: "https://new.example" }] });
    expect(replaceRes.status).toBe(200);
    expect(replaceRes.body.charities).toHaveLength(0);
    expect(replaceRes.body.sponsors).toHaveLength(1);
    expect(replaceRes.body.sponsors[0].name).toBe("New Sponsor");
  });

  it("appears on the Open Leagues card once listed", async () => {
    if (!schemaReady) return;
    await sql(
      `INSERT INTO league_listing (league_id, is_listed, accepting_signups, accepting_waitlist, platform, competitiveness)
       VALUES ($1, TRUE, TRUE, TRUE, 'crossplay', 'casual')`,
      [leagueId],
    );
    const res = await request(app).get(`/api/leagues/open`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: any) => r.league_id === leagueId);
    expect(row).toBeTruthy();
    expect(row.partners.sponsors).toHaveLength(1);
    expect(row.partners.sponsors[0].name).toBe("New Sponsor");
  });
});
