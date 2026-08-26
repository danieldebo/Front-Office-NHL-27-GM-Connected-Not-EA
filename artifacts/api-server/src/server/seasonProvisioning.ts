import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

const CLUBS = [
  ["BOS", "Boston Bruins", "Eastern", "Atlantic"],
  ["BUF", "Buffalo Sabres", "Eastern", "Atlantic"],
  ["DET", "Detroit Red Wings", "Eastern", "Atlantic"],
  ["FLA", "Florida Panthers", "Eastern", "Atlantic"],
  ["MTL", "Montreal Canadiens", "Eastern", "Atlantic"],
  ["OTT", "Ottawa Senators", "Eastern", "Atlantic"],
  ["TBL", "Tampa Bay Lightning", "Eastern", "Atlantic"],
  ["TOR", "Toronto Maple Leafs", "Eastern", "Atlantic"],
  ["CAR", "Carolina Hurricanes", "Eastern", "Metropolitan"],
  ["CBJ", "Columbus Blue Jackets", "Eastern", "Metropolitan"],
  ["NJD", "New Jersey Devils", "Eastern", "Metropolitan"],
  ["NYI", "New York Islanders", "Eastern", "Metropolitan"],
  ["NYR", "New York Rangers", "Eastern", "Metropolitan"],
  ["PHI", "Philadelphia Flyers", "Eastern", "Metropolitan"],
  ["PIT", "Pittsburgh Penguins", "Eastern", "Metropolitan"],
  ["WSH", "Washington Capitals", "Eastern", "Metropolitan"],
  ["CHI", "Chicago Blackhawks", "Western", "Central"],
  ["COL", "Colorado Avalanche", "Western", "Central"],
  ["DAL", "Dallas Stars", "Western", "Central"],
  ["MIN", "Minnesota Wild", "Western", "Central"],
  ["NSH", "Nashville Predators", "Western", "Central"],
  ["STL", "St. Louis Blues", "Western", "Central"],
  ["UTA", "Utah Hockey Club", "Western", "Central"],
  ["WPG", "Winnipeg Jets", "Western", "Central"],
  ["ANA", "Anaheim Ducks", "Western", "Pacific"],
  ["CGY", "Calgary Flames", "Western", "Pacific"],
  ["EDM", "Edmonton Oilers", "Western", "Pacific"],
  ["LAK", "Los Angeles Kings", "Western", "Pacific"],
  ["SEA", "Seattle Kraken", "Western", "Pacific"],
  ["SJS", "San Jose Sharks", "Western", "Pacific"],
  ["VAN", "Vancouver Canucks", "Western", "Pacific"],
  ["VGK", "Vegas Golden Knights", "Western", "Pacific"],
] as const;
const CLUB_ABBREVS = CLUBS.map(([abbrev]) => abbrev);

export async function ensureClubCatalog(client: PoolClient): Promise<void> {
  const values = CLUBS.flat();
  const placeholders = CLUBS.map((_, index) => {
    const offset = index * 4;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
  }).join(", ");

  await client.query(
    `INSERT INTO nhl_club (abbrev, name, conference, division)
     VALUES ${placeholders}
     ON CONFLICT (abbrev) DO UPDATE
       SET name = EXCLUDED.name,
           conference = EXCLUDED.conference,
           division = EXCLUDED.division`,
    values,
  );
}

export async function provisionSeasonSeats(
  client: PoolClient,
  leagueId: string,
  seasonId: string,
): Promise<void> {
  const clubs = await client.query<{
    id: string;
    abbrev: string;
    name: string;
    conference: string | null;
    division: string | null;
  }>(
    `SELECT id, abbrev, name, conference, division
       FROM nhl_club
      WHERE abbrev = ANY($1::text[])
      ORDER BY conference, division, abbrev`,
    [CLUB_ABBREVS],
  );

  if (clubs.rows.length !== CLUBS.length) {
    throw new Error(`Expected ${CLUBS.length} clubs, found ${clubs.rows.length}`);
  }

  for (const club of clubs.rows) {
    const existingFranchise = await client.query<{ id: string }>(
      `SELECT f.id FROM franchise f
        WHERE f.league_id = $1
          AND EXISTS (
            SELECT 1 FROM team_season ts
             WHERE ts.franchise_id = f.id AND ts.nhl_club_id = $2
          )
        LIMIT 1`,
      [leagueId, club.id],
    );

    let franchiseId = existingFranchise.rows[0]?.id;
    if (!franchiseId) {
      const newFranchise = await client.query<{ id: string }>(
        `INSERT INTO franchise (league_id, name, founded_season_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [leagueId, club.name, seasonId],
      );
      franchiseId = newFranchise.rows[0]!.id;
    }

    await client.query(
      `INSERT INTO team_season
         (season_id, franchise_id, nhl_club_id, conference, division, seat_status)
       VALUES ($1, $2, $3, $4, $5, 'open')
       ON CONFLICT DO NOTHING`,
      [seasonId, franchiseId, club.id, club.conference, club.division],
    );
  }

  const seatCount = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM team_season ts
       JOIN nhl_club nc ON nc.id = ts.nhl_club_id
      WHERE ts.season_id = $1
        AND nc.abbrev = ANY($2::text[])`,
    [seasonId, CLUB_ABBREVS],
  );
  if (Number(seatCount.rows[0]?.count ?? 0) !== CLUBS.length) {
    throw new Error(`Season ${seasonId} was not provisioned with ${CLUBS.length} seats`);
  }
}

export async function repairActiveSeasonSeats(leagueId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);

    const activeSeason = await client.query<{ id: string; required_seat_count: string }>(
      `SELECT s.id, COUNT(nc.id)::text AS required_seat_count
         FROM season s
         LEFT JOIN team_season ts ON ts.season_id = s.id
         LEFT JOIN nhl_club nc
           ON nc.id = ts.nhl_club_id
          AND nc.abbrev = ANY($2::text[])
        WHERE s.league_id = $1 AND s.is_active = TRUE
        GROUP BY s.id
        LIMIT 1`,
      [leagueId, CLUB_ABBREVS],
    );

    const season = activeSeason.rows[0];
    if (!season || Number(season.required_seat_count) === CLUBS.length) {
      await client.query("COMMIT");
      return;
    }

    await ensureClubCatalog(client);
    await provisionSeasonSeats(client, leagueId, season.id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}