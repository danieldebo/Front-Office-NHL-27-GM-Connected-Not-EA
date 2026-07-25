# Front Office — Keepers & Player Registry (Addendum)

**Doc version:** 1.0
**Amends:** `front-office-v1-spec.md` §3, `PHASE_1_SCOPE.md` (Phase 2
checkpoints), `db/schema-keepers.sql`
**Phase:** 2 — build alongside membership

A keeper league lets teams retain a set number of players between seasons.
This addendum adds the keeper mechanics, an indexed NHL player registry to enter
them against, and a 1/3/5-year stat card when an entry matches a real player.

The design leans on two things already built: the `franchise` continuity layer
(so keeper tenure survives across seasons) and the `player.external_ids` +
provenance model (so registry-matched and manually-entered players coexist
cleanly).

---

## 1. Keeper limit — commissioner-set, enforced

`season.keepers_per_team` is set by the commissioner (0 disables keepers for the
season). A database trigger refuses a team's (N+1)th keeper, the same way the
seat limit and active-GM constraint are enforced at the write, not caught later.

The "2 / 3 keepers" count comes from `v_keeper_slots` and appears on every team
admin page. Lowering the limit below what a team already holds is caught by a
DQ check; the UI should warn before allowing it and require the commissioner to
release the excess.

---

## 2. Who can do what

| Action | Team GM | Commissioner |
|---|---|---|
| Add a keeper to **their own** team | ✓ (up to the limit) | ✓ |
| Edit/remove a keeper on **their own** team | ✓ | ✓ |
| Add/edit/remove a keeper on **any** team | — | ✓ (override) |
| Set `keepers_per_team` | — | ✓ |

A commissioner add/edit/remove on another team's roster sets
`is_commissioner_override = true` on the keeper row, so the roster shows who made
each designation. The override is about *whose* roster the commissioner may
touch — it does not let anyone exceed the season limit. If a league wants the
commissioner to exceed it, they raise the limit; the cap stays honest.

All of this routes through `server/authz.ts` — no inline checks. "GM writes only
their own team; commissioner writes league-scoped" is exactly the existing rule.

---

## 3. Original-marked date & keeper tenure

The requirement to "track the original date they are marked keeper" is doing more
work than it first looks — it's the foundation for keeper-tenure rules, which
most keeper leagues have ("you may keep a player at most 3 years").

- `keeper.first_marked_at` is set once, the first time a franchise designates a
  player, and **carried forward** on every re-designation by the
  `inherit_keeper_origin` trigger. Re-keeping a player next season inherits the
  original date rather than resetting it.
- `keeper.designated_at` records when *this season's* designation was made.
- `v_active_keepers.seasons_kept` counts the distinct seasons a franchise has
  kept a player — the number a "max N years" rule is written against.

Because keepers attach to `franchise`, not `team_season`, tenure survives a GM
change. A player kept for three years stays a three-year keeper even if two
different GMs made those designations. This is the continuity layer paying off
again.

Releasing a keeper closes the row (`released_at`) rather than deleting it, so the
tenure history stays intact and auditable. Re-keeping later still sees the
original date.

---

## 4. The NHL player registry

### Source

The registry is seeded and refreshed from the **free, keyless public NHL API**.
Two endpoints matter:

- **Roster / identity & season summaries** — `api.nhle.com/stats/rest/en/skater/summary`
  and `.../goalie/summary`, filtered by `cayenneExp=seasonId=YYYYYYYY`. Returns
  per-player season stat lines with the NHL player id.
- **Per-player detail** — `api-web.nhle.com/v1/player/{id}/landing` for bio and
  career splits.

No API key is required. Both are undocumented-but-stable community-mapped APIs;
treat them as an upstream that can change shape, which is exactly what the
`ingest_batch` / provenance discipline already assumes.

### Storage

The existing `player` table **is** the registry. This delta makes it searchable:

- `player.external_ids->>'nhl_api'` holds the NHL player id for registry-backed
  players; a unique partial index prevents duplicates.
- A **pg_trgm GIN index** on `full_name` powers typo-tolerant "start typing"
  search across every player. This is what makes the lookup feel instant and
  forgiving of "McDavid" vs "Mcdavid" vs "mcdavid".
- A scheduled `registry_sync` upserts the player pool (weekly is plenty; rosters
  don't churn daily) and stamps `registry_synced_at`.

### Manual entry is first-class

When a name doesn't match — a prospect, an AHL call-up, a created player, a
misspelling the league prefers — the GM enters it manually. That creates a
`player` row with `is_manual = true` and empty `external_ids`. A manual keeper is
fully valid; it simply has no stat card until someone matches it to a real
player.

The `check_manual_keeper_matchable` DQ view surfaces manual entries that *do*
have a close registry match, so a commissioner can promote them later and unlock
the card. Promotion is a match, not a re-entry: set `external_ids.nhl_api`, and
the manual flag clears.

---

## 5. The 1/3/5-year stat card

When a keeper is registry-matched, the team admin page shows three cards: last 1
season, last 3, last 5.

### What it is

- Aggregated real-world NHL stats over each window, from the NHL API.
- Skater line: GP, G, A, PTS, +/−, PIM, SOG, S%, TOI/GP. Goalie line: GP, GS, W,
  L, OTL, SV%, GAA, SO.
- `season_span` labels the window ("2022-23 – 2024-25") so a partial career
  reads honestly — a sophomore simply has a shorter 5-year card.

### How it's handled — this is the important part

Stat-card data is **fetched reference data, not league game data.** It follows
the same rule as anything the platform fetches (the search/connector discipline):
cache it, timestamp it, refresh on staleness, and never present it as a number
the platform authored or blend it into league standings.

- Cached in `player_stat_card`, one row per `(player_id, window_years)`.
- `fetched_at` and `stale_after` (7-day default) drive refresh-on-view.
- The card visibly shows "NHL stats as of {fetched_at}" so nobody mistakes real
  -world stats for their league's game data. These are two different universes
  and the UI must never blur them — a keeper's real NHL production has nothing to
  do with how their franchise is doing in the sim.
- If the NHL API is unreachable, show the last cached card with its date, or a
  graceful "stats unavailable" — never a spinner that never resolves, and never a
  fabricated line.

### Rate & etiquette

Batch the sync; don't hammer the NHL API per page view. The stale-after cache
means a popular player is fetched roughly weekly regardless of how many times his
card is viewed. Respect the upstream — a per-host request budget and backoff, the
same as any polite integration.

---

## 6. Checkpoints (Phase 2 additions)

Fold these in after membership (Checkpoints 7–9).

### Checkpoint 10 — Player registry

**Build**
- `registry_sync` job pulling the skater + goalie player pool from the NHL API
  into `player` with `nhl_api` external ids
- pg_trgm search endpoint: type-ahead name lookup across the registry
- Manual-entry path creating an `is_manual` player when no match is chosen
- Promote-manual-to-matched flow

**Acceptance**
- Typing a partial, slightly misspelled name returns the right player fast
- Selecting a match stores the NHL id; choosing "none of these / add manually"
  creates a manual player
- Re-running the sync updates existing players, never duplicates them
  (`player_nhl_id_unique` holds)

### Checkpoint 11 — Keepers

**Build**
- `season.keepers_per_team` setting in league/season config
- Team keeper entry (their own team, up to the limit) via registry search or
  manual entry
- Commissioner override to add/edit/remove on any team, flagged as override
- `first_marked_at` origin inheritance across seasons; release closes the row
- `v_keeper_slots` "N / max" everywhere keepers appear

**Acceptance**
- The (limit+1)th keeper is refused by the database, surfaced as a clean 409
- A commissioner can edit another team's keepers; a GM cannot — proven by test
- Re-keeping a player a second season inherits the original `first_marked_at`;
  `seasons_kept` reads 2
- Releasing then re-adding a keeper preserves the original date
- Disabling keepers (limit 0) blocks all designations with a clear message

### Checkpoint 12 — Stat cards

**Build**
- 1/3/5-year card on the team admin page for registry-matched keepers
- `player_stat_card` cache with refresh-on-staleness
- "NHL stats as of {date}" labelling; graceful unavailable state
- Batched fetch with backoff; never per-view hammering

**Acceptance**
- A matched keeper shows three cards with correct spans; a sophomore's 5-year
  card is honestly short, not padded
- A manual keeper shows no card and a "match to unlock stats" affordance
- With the NHL API blocked, the page shows cached or unavailable, never a hang
  or a fabricated line
- Viewing the same card 50 times triggers one fetch, not 50

---

## 7. What not to do

- **Don't blend NHL stats into league standings.** Real-world production and sim
  performance are different universes; the card is context, not a league stat.
- **Don't block keeper entry on a registry match.** Manual entry is first-class;
  a prospect with no NHL history must still be keepable.
- **Don't reset `first_marked_at` on re-designation.** Tenure is the whole point
  of tracking the original date.
- **Don't hammer the NHL API.** Cache, batch, back off. It's free and keyless;
  keep it that way by being a polite client.
- **Don't fabricate a stat line** when the fetch fails. Cached-with-date or
  unavailable — never invented.
