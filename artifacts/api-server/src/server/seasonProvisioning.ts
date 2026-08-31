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

// A small curated set of well-known, long-standing clubs from four other
// real leagues — not a live or exhaustive roster — that a commissioner can
// swap a franchise seat's club to via the team catalog (see routes/clubs.ts,
// PATCH /team-seasons/:id/club). Season provisioning itself (below) only
// ever draws from CLUBS (NHL) — that invariant is unaffected by this list.
const ALT_CLUBS = [
  ["FHC", "Frölunda HC", "SHL"],
  ["DIF", "Djurgårdens IF", "SHL"],
  ["FBK", "Färjestad BK", "SHL"],
  ["HV71", "HV71", "SHL"],
  ["LHF", "Luleå HF", "SHL"],
  ["SAIK", "Skellefteå AIK", "SHL"],
  ["BIF", "Brynäs IF", "SHL"],
  ["LHC", "Linköping HC", "SHL"],
  ["EBB", "Eisbären Berlin", "DEL"],
  ["MAN", "Adler Mannheim", "DEL"],
  ["KEC", "Kölner Haie", "DEL"],
  ["ERC", "ERC Ingolstadt", "DEL"],
  ["WOB", "Grizzlys Wolfsburg", "DEL"],
  ["STR", "Straubing Tigers", "DEL"],
  ["NIT", "Nürnberg Ice Tigers", "DEL"],
  ["DEG", "Düsseldorfer EG", "DEL"],
  ["TAP", "Tappara", "LIIGA"],
  ["KAR", "Kärpät Oulu", "LIIGA"],
  ["HIFK", "HIFK", "LIIGA"],
  ["JYP", "JYP Jyväskylä", "LIIGA"],
  ["ILV", "Ilves Tampere", "LIIGA"],
  ["TPS", "TPS Turku", "LIIGA"],
  ["LUK", "Lukko Rauma", "LIIGA"],
  ["PEL", "Pelicans Lahti", "LIIGA"],
  ["TOL", "Toledo Walleye", "ECHL"],
  ["WHL", "Wheeling Nailers", "ECHL"],
  ["FLE", "Florida Everblades", "ECHL"],
  ["CIN", "Cincinnati Cyclones", "ECHL"],
  ["NFL", "Newfoundland Growlers", "ECHL"],
  ["IDH", "Idaho Steelheads", "ECHL"],
  ["KAL", "Kalamazoo Wings", "ECHL"],
  ["NOR", "Norfolk Admirals", "ECHL"],
] as const;

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

  const altValues = ALT_CLUBS.flat();
  const altPlaceholders = ALT_CLUBS.map((_, index) => {
    const offset = index * 3;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
  }).join(", ");

  await client.query(
    `INSERT INTO nhl_club (abbrev, name, league_source)
     VALUES ${altPlaceholders}
     ON CONFLICT (abbrev) DO UPDATE
       SET name = EXCLUDED.name,
           league_source = EXCLUDED.league_source`,
    altValues,
  );
}

export async function provisionSeasonSeats(
  client: PoolClient,
  leagueId: string,
  seasonId: string,
  teamCount: number = CLUBS.length,
): Promise<void> {
  if (!Number.isInteger(teamCount) || teamCount < 3 || teamCount > CLUBS.length) {
    throw new Error(`teamCount must be between 3 and ${CLUBS.length}`);
  }
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

  const configuredClubs = clubs.rows.slice(0, teamCount);
  for (const club of configuredClubs) {
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
  if (Number(seatCount.rows[0]?.count ?? 0) !== teamCount) {
    throw new Error(`Season ${seasonId} was not provisioned with ${teamCount} seats`);
  }
}

export async function repairActiveSeasonSeats(leagueId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [leagueId]);

    const activeSeason = await client.query<{
      id: string; required_seat_count: string; team_count: number;
    }>(
      `SELECT s.id, COUNT(nc.id)::text AS required_seat_count,
              COALESCE(v.team_count, s.max_seats, 32) AS team_count
         FROM season s
          LEFT JOIN league_settings_version v ON v.id = s.settings_version_id
         LEFT JOIN team_season ts ON ts.season_id = s.id
         LEFT JOIN nhl_club nc
           ON nc.id = ts.nhl_club_id
          AND nc.abbrev = ANY($2::text[])
        WHERE s.league_id = $1 AND s.is_active = TRUE
         GROUP BY s.id, v.team_count, s.max_seats
        LIMIT 1`,
      [leagueId, CLUB_ABBREVS],
    );

    const season = activeSeason.rows[0];
    if (!season || Number(season.required_seat_count) >= season.team_count) {
      await client.query("COMMIT");
      return;
    }

    await ensureClubCatalog(client);
    await provisionSeasonSeats(client, leagueId, season.id, season.team_count);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}