/**
 * Weekly commissioner email digest — reuses the outbox (topic 'email.digest',
 * drained by outboxWorker.ts) rather than sending mail in-request, the same
 * plumbing built for Discord posts and the registry sync job.
 *
 * runDigestTick is meant to be called on a short interval (e.g. every 15
 * minutes, see startDigestScheduler). Each call:
 *   1. Finds leagues whose digest_enabled is on and whose configured
 *      day/hour, evaluated in the league's own digest_timezone, matches the
 *      current moment.
 *   2. Skips a league that already has a league_digest_send_log row for
 *      today (in its own timezone) — the dedup key against double-firing
 *      inside the same hour window.
 *   3. Skips an "inactive" league — heuristically, one with no game whose
 *      window falls within the trailing/leading 30 days. A quiet off-season
 *      league shouldn't nag its GMs weekly.
 *   4. Renders the commissioner's template (or a sensible default) and
 *      enqueues one outbox row per non-unsubscribed member with an email.
 */
import type { Pool } from "pg";

const DEFAULT_TEMPLATE = `{{league_name}} — Weekly Digest

STANDINGS
{{standings}}

RECENT RESULTS
{{recent_results}}

UPCOMING GAMES
{{upcoming_games}}

---
Unsubscribe: {{unsubscribe_url}}`;

interface DigestLeague {
  id: string;
  name: string;
  digest_day_of_week: number;
  digest_hour_local: number;
  digest_timezone: string;
  digest_template_md: string | null;
}

function localDayAndHour(now: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days.indexOf(weekdayStr);
  // Intl can format midnight as "24" with hour12:false in some engines.
  const hour = Number(hourStr) % 24;
  return { day: day === -1 ? 0 : day, hour };
}

function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now); // YYYY-MM-DD
}

function renderTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? "");
}

export async function runDigestTick(pool: Pool, now: Date = new Date()): Promise<{ sent: number }> {
  const { rows: leagues } = await pool.query<DigestLeague>(
    `SELECT id, name, digest_day_of_week, digest_hour_local, digest_timezone, digest_template_md
       FROM league
      WHERE digest_enabled = TRUE AND deleted_at IS NULL`
  );

  let sent = 0;

  for (const league of leagues) {
    let localDay: number, localHour: number, localDate: string;
    try {
      ({ day: localDay, hour: localHour } = localDayAndHour(now, league.digest_timezone));
      localDate = localDateString(now, league.digest_timezone);
    } catch {
      continue; // invalid timezone string — skip rather than crash the tick
    }

    if (localDay !== league.digest_day_of_week || localHour !== league.digest_hour_local) continue;

    const alreadySent = await pool.query(
      `SELECT 1 FROM league_digest_send_log WHERE league_id = $1 AND sent_for_date = $2`,
      [league.id, localDate]
    );
    if (alreadySent.rows[0]) continue;

    const activity = await pool.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM game g
           JOIN season s ON s.id = g.season_id
          WHERE s.league_id = $1
            AND g.window_closes_at BETWEEN now() - INTERVAL '30 days' AND now() + INTERVAL '30 days'
       ) AS active`,
      [league.id]
    );
    if (!activity.rows[0]?.active) continue;

    const seasonRow = await pool.query<{ id: string }>(
      `SELECT id FROM season WHERE league_id = $1 AND is_active = TRUE LIMIT 1`,
      [league.id]
    );
    const seasonId = seasonRow.rows[0]?.id ?? null;

    const standingsRows = seasonId
      ? await pool.query<{ franchise_name: string | null; gp: number; w: number; l: number; otl: number; points: number }>(
          `SELECT f.name AS franchise_name, COALESCE(vs.gp,0) AS gp, COALESCE(vs.w,0) AS w,
                  COALESCE(vs.l,0) AS l, COALESCE(vs.otl,0) AS otl, COALESCE(vs.points,0) AS points
             FROM team_season ts
             JOIN franchise f ON f.id = ts.franchise_id
             LEFT JOIN v_standings vs ON vs.team_season_id = ts.id
            WHERE ts.season_id = $1
            ORDER BY points DESC, w DESC`,
          [seasonId]
        )
      : { rows: [] };

    const standingsText = standingsRows.rows.length
      ? standingsRows.rows
          .map((r, i) => `${i + 1}. ${r.franchise_name ?? "Unnamed"} — ${r.w}-${r.l}-${r.otl} (${r.points} pts)`)
          .join("\n")
      : "No standings yet.";

    const recentRows = seasonId
      ? await pool.query<{ home: string; away: string; home_goals: number; away_goals: number }>(
          `SELECT hf.name AS home, af.name AS away, gr.home_goals, gr.away_goals
             FROM game g
             JOIN game_result gr ON gr.game_id = g.id AND gr.superseded_by IS NULL
             JOIN team_season hts ON hts.id = g.home_team_season_id
             JOIN team_season ats ON ats.id = g.away_team_season_id
             JOIN franchise hf ON hf.id = hts.franchise_id
             JOIN franchise af ON af.id = ats.franchise_id
            WHERE g.season_id = $1 AND g.status = 'confirmed'
              AND g.window_closes_at BETWEEN now() - INTERVAL '7 days' AND now()
            ORDER BY g.window_closes_at DESC
            LIMIT 10`,
          [seasonId]
        )
      : { rows: [] };
    const recentText = recentRows.rows.length
      ? recentRows.rows.map((r) => `${r.away} ${r.away_goals} @ ${r.home} ${r.home_goals}`).join("\n")
      : "No results this week.";

    const upcomingRows = seasonId
      ? await pool.query<{ home: string; away: string; window_opens_at: Date }>(
          `SELECT hf.name AS home, af.name AS away, g.window_opens_at
             FROM game g
             JOIN team_season hts ON hts.id = g.home_team_season_id
             JOIN team_season ats ON ats.id = g.away_team_season_id
             JOIN franchise hf ON hf.id = hts.franchise_id
             JOIN franchise af ON af.id = ats.franchise_id
            WHERE g.season_id = $1 AND g.status = 'scheduled'
              AND g.window_opens_at BETWEEN now() AND now() + INTERVAL '7 days'
            ORDER BY g.window_opens_at ASC
            LIMIT 10`,
          [seasonId]
        )
      : { rows: [] };
    const upcomingText = upcomingRows.rows.length
      ? upcomingRows.rows
          .map((r) => `${r.away} @ ${r.home} — ${new Date(r.window_opens_at).toDateString()}`)
          .join("\n")
      : "No games scheduled this week.";

    const recipients = await pool.query<{ email: string; digest_unsub_token: string }>(
      `SELECT u.email, m.digest_unsub_token
         FROM league_membership m
         JOIN app_user u ON u.id = m.user_id
        WHERE m.league_id = $1 AND m.left_at IS NULL AND m.digest_unsubscribed_at IS NULL`,
      [league.id]
    );

    const template = league.digest_template_md ?? DEFAULT_TEMPLATE;

    for (const recipient of recipients.rows) {
      const text = renderTemplate(template, {
        league_name: league.name,
        standings: standingsText,
        recent_results: recentText,
        upcoming_games: upcomingText,
        unsubscribe_url: `/api/digest/unsubscribe/${recipient.digest_unsub_token}`,
      });
      await pool.query(`INSERT INTO outbox (topic, payload) VALUES ('email.digest', $1)`, [
        JSON.stringify({ to: recipient.email, subject: `${league.name} — Weekly Digest`, text }),
      ]);
      sent++;
    }

    await pool.query(
      `INSERT INTO league_digest_send_log (league_id, sent_for_date, recipients)
       VALUES ($1, $2, $3)
       ON CONFLICT (league_id, sent_for_date) DO NOTHING`,
      [league.id, localDate, recipients.rows.length]
    );
  }

  return { sent };
}

export function startDigestScheduler(pool: Pool, intervalMs = 15 * 60 * 1000): { stop: () => void } {
  const timer = setInterval(() => {
    runDigestTick(pool).catch(() => {
      // Errors are logged inside runDigestTick's callers via the outbox
      // worker's own error path; a bad tick here should not crash the
      // process, and there is always a next tick.
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
