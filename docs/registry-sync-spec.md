# Front Office — Registry Sync & Stat-Card Jobs (Spec)

**Doc version:** 1.0
**Amends:** `docs/keeper-addendum.md` §4–5, `db/schema-keepers.sql`
**Phase:** 2 · Checkpoint 10 (registry) and Checkpoint 12 (cards)

Two jobs, one upstream. The **registry sync** keeps `player` populated with every
NHL player so keepers can be entered against a real identity. The **stat-card
refresh** fills the 1/3/5-year cards on demand. Both talk to the free, keyless
public NHL API and both follow the same rule: this is fetched reference data —
cache it, stamp it, back off, never author it.

---

## 1. Upstream endpoints

Two APIs, no key. Treat both as undocumented-but-stable: they can change shape,
so every response is validated before it touches `player`.

| Purpose | Endpoint | Notes |
|---|---|---|
| Skater season summaries | `GET api.nhle.com/stats/rest/en/skater/summary` | Paginated; `cayenneExp=seasonId=YYYYYYYY`, `limit`, `start` |
| Goalie season summaries | `GET api.nhle.com/stats/rest/en/goalie/summary` | Same shape, goalie fields |
| Player landing / bio | `GET api-web.nhle.com/v1/player/{playerId}/landing` | Bio, position, current team, career splits |

`seasonId` is `YYYYYYYY` (e.g. `20242025`). `gameTypeId=2` is regular season.
The stats endpoints return an NHL `playerId` on every row — that id is the join
key into `player.external_ids->>'nhl_api'`.

Add these to `.env.example` (defaults, not secrets — there's no key):

```
NHL_STATS_API_BASE=https://api.nhle.com/stats/rest/en
NHL_WEB_API_BASE=https://api-web.nhle.com/v1
REGISTRY_SYNC_SEASONS=5          # how many recent seasons to pull the pool from
REGISTRY_SYNC_CRON=0 8 * * 1     # weekly, Monday 08:00 (rosters don't churn daily)
NHL_API_MAX_RPS=4                # polite ceiling; we are a guest
NHL_API_MAX_RETRIES=4
STATCARD_STALE_DAYS=7
```

---

## 2. Registry sync job

### Shape

```
registry_sync (scheduled weekly)
  └─ open a registry_sync row (source='nhl_stats_api')
  └─ for each of the last REGISTRY_SYNC_SEASONS seasons:
       └─ page skater/summary  (limit=100, start+=100 until a short page)
       └─ page goalie/summary
  └─ collapse to a distinct set of players (a player spans seasons)
  └─ upsert each into `player` keyed on external_ids->>'nhl_api'
  └─ close the row with players_upserted, completed_at
```

### Upsert contract

One player per NHL id. The `player_nhl_id_unique` index makes this safe under
retries. Never insert a second row for an id that exists.

```sql
INSERT INTO player (full_name, position, shoots, birthdate, country_code,
                    current_team_abbrev, sweater_num, external_ids,
                    registry_synced_at, is_manual)
VALUES ($1,$2,$3,$4,$5,$6,$7, jsonb_build_object('nhl_api', $8::text), now(), false)
ON CONFLICT ((external_ids->>'nhl_api')) WHERE external_ids ? 'nhl_api'
DO UPDATE SET
    full_name           = EXCLUDED.full_name,
    position            = EXCLUDED.position,
    current_team_abbrev = EXCLUDED.current_team_abbrev,
    sweater_num         = EXCLUDED.sweater_num,
    registry_synced_at  = now();
```

Rules that matter:
- **Never touch `is_manual` players.** The upsert only ever writes rows it owns
  (registry-backed). A manually-entered player is invisible to the sync.
- **A trade changes `current_team_abbrev`, not identity.** Update in place.
- **A retired player stays in the registry.** Don't delete players who drop out
  of a recent season — a keeper league may still hold them. Absence from the
  latest pull is not a delete signal.
- **Idempotent by construction.** Re-running the whole job changes nothing but
  `registry_synced_at`. That's the test.

### Validation before write

Each upstream row passes a Zod schema first. A row that fails (missing id,
unparseable position) goes to a quarantine count on the `registry_sync` row and
is skipped — **one bad row never fails the batch**, the same discipline as
ingest. Log the count, not the PII.

### Cold start

First run with `REGISTRY_SYNC_SEASONS=5` pulls ~5 seasons of skaters + goalies —
low thousands of players, a few minutes at 4 rps. Run it once at setup before any
league needs keepers; the weekly cron keeps it warm after.

---

## 3. Stat-card refresh job

### Trigger — lazy, not eager

Cards are filled **on view, when stale**, not pre-computed for every player. Most
players are never kept and never need a card.

```
GET team admin page
  └─ for each registry-matched keeper:
       └─ read player_stat_card rows (1,3,5)
       └─ if missing OR stale_after < now():
            └─ enqueue a refresh (do NOT block the page render)
       └─ render whatever is cached now; the fresh card arrives on next load
```

The page never waits on the NHL API. It shows the cached card (with its date) or
a "fetching latest…" placeholder that resolves on the next view. A dead upstream
degrades to stale-or-unavailable, never a hang.

### Composition

For a player's `nhl_api` id, pull per-season lines and aggregate into three
windows. Partial careers produce honestly short windows — a sophomore's 5-year
card spans two seasons and says so via `season_span`.

```
windows = {1: [last season],
           3: [last 3 seasons present],
           5: [last 5 seasons present]}
skater aggregate: GP, G, A, PTS, PIM, SOG summed; +/- summed;
                  S% = SOG>0 ? G/SOG : 0; TOI/GP = ΣTOI / ΣGP
goalie aggregate: GP, GS, W, L, OTL, SO summed;
                  SV% = ΣSV/ΣSA ; GAA = ΣGA*3600 / ΣTOI_seconds
```

Upsert into `player_stat_card` on `(player_id, window_years)`, set `fetched_at`,
`stale_after = now() + STATCARD_STALE_DAYS`, `season_span`.

### The rule this job exists to respect

These are real-world NHL stats. They are labelled "NHL stats as of {fetched_at}",
never merged into `v_standings`, never presented as a number the league produced
(replit.md rule 17). The refresh job writes only to `player_stat_card` — it has
no reach into any league fact table, by design.

---

## 4. Being a polite guest on a free API

The NHL API is free and keyless. Keeping it that way is on us.

- **Rate limit outbound** to `NHL_API_MAX_RPS` across the whole app, not
  per-request — a token-bucket in front of the client, shared by both jobs.
- **Exponential backoff with jitter** on 429/5xx, up to `NHL_API_MAX_RETRIES`,
  then give up gracefully and leave the cache as-is.
- **Conditional requests** where the upstream supports `ETag`/`If-Modified-Since`
  — skip re-parsing unchanged data.
- **A single in-flight fetch per player.** Fifty views of one card while a fetch
  is pending coalesce to one request (a per-player lock or a de-dupe on the
  outbox `dedupe_key`), so a popular player never fans out into a storm.
- **Batch the registry sync**, don't interleave it with card fetches during peak
  hours. Weekly at 08:00 Monday is deliberately off everyone's game nights.
- **Cache is the throttle.** With a 7-day `stale_after`, a card is fetched
  roughly weekly no matter how many times it's viewed. The cache isn't an
  optimization here, it's the courtesy mechanism.

### Where it runs on Replit

Both jobs are Postgres-backed and drained by the same worker pattern as the
outbox — no separate queue service. Checkpoint 10/12 acceptance tests assert the
idempotency (re-run changes nothing) and the coalescing (N views → 1 fetch)
directly.

---

## 5. Failure modes and the honest answer to each

| Failure | Behavior |
|---|---|
| NHL API down during sync | `registry_sync` row records the error; existing registry untouched; retry next cron |
| NHL API down during card view | Show cached card + date, or "stats unavailable"; never hang, never fabricate |
| Upstream changes response shape | Zod validation fails the affected rows into quarantine; batch continues; alert on a spike |
| A player has < 1 full season | 1-year card shows the partial season honestly; 3/5 span what exists |
| Two jobs race on the same player | Per-player lock; one fetch wins, the other reads the fresh cache |
| Rate limit hit | Back off with jitter; the cache covers the gap |
