# Front Office — Data Model & Export Contract

**Doc version:** 1.0
**Schema version:** 1.0.0 (see `schema.sql`)
**Export schema version:** 1.0.0

---

## 1. Entity map

```
app_user
   └── league_membership ──► league
                              ├── rulebook_revision      (versioned bylaws)
                              ├── franchise              ◄── PERSISTS ACROSS SEASONS
                              └── season                     (one game title each)
                                    └── team_season       (franchise + season + NHL club)
                                          ├── gm_assignment ──► app_user
                                          ├── contract ──► player
                                          └── game (home / away)
                                                └── game_result      (append-only)
                                                      ├── skater_game_stat
                                                      └── goalie_game_stat

transaction_event ──┬── transaction_asset
                    └── transaction_approval

ingest_batch ──► (referenced by every machine-sourced row)
audit_log    ──► (references every entity)
```

The load-bearing distinction is **franchise vs. team_season**.

A `franchise` belongs to the league and never dies. A `team_season` is that franchise's
participation in one season, controlling one NHL club, run by one or more GMs. This is what
makes the platform survive the annual release cycle: when NHL 28 ships, you create a new
`season` with `game_title = 'NHL28'`, attach the same franchises, and every banner, record, and
retired number is still there. That continuity is the product.

It also cleanly answers "what happens when a GM quits in February." The `gm_assignment` closes,
a new one opens, the franchise record is untouched, and both GMs keep an accurate career line.

---

## 2. Six decisions worth defending

**1. Nothing is ever overwritten.**
`game_result`, `contract`, and `transaction_event` are append-only. A correction writes a new
row and sets `superseded_by` on the old one with a `supersede_reason`. A reversed trade is a new
`transaction_event` with `reverses_txn_id` set. The cost is a `WHERE superseded_by IS NULL`
in most queries. The benefit is that "the commissioner changed my score and won't say why" stops
being a category of dispute that exists.

**2. Derived numbers are never stored as editable state.**
Standings, cap position, and league leaders are views (`v_standings`, `v_cap_position`). There is
no `points` column anyone can edit. Fix a bad score and every downstream number fixes itself.
The alternative — stored standings kept in sync by application code — is how every homebrew
league tracker eventually produces a table that disagrees with its own game log.

**3. Every fact carries provenance.**
`data_source`, `ingest_batch_id`, `confidence`, `reported_by`, `verified_by`. This is four
columns that look like overhead in month one and become the entire integration story in year
two. It is also what lets the UI honestly show a GM *why* a number is what it is.

**4. Authority is data, not code.**
`data_source_authority` ranks sources. `partner_api` is pre-registered at rank 90 and unused.
When an authoritative feed appears, it outranks everything without a deploy, and reconciliation
becomes a query rather than a rewrite.

**5. Windows, not clock times.**
`game` has `window_opens_at` / `window_closes_at`, not a single `scheduled_at`. Thirty-two
adults across six time zones cannot reliably meet at 8:15 PM. They can reliably meet sometime
between Monday and Sunday. Modeling the window is the difference between a schedule that
completes and one that stalls in week three.

**6. Money is modeled, never moved.**
`cap_hit_cents` is integer cents. There is no table for league dues, buy-ins, or payouts,
because handling other people's money invites disputes and obligations that have nothing to do
with the product. If a ledger is ever needed, it records amounts — it does not process them.

---

## 3. Preparing for an EA export

Assume that at some point an authoritative feed exists: an official export, a partner API, or a
community stream. The goal is that absorbing it is an afternoon, not a migration.

### Hooks already in place

| Hook | Where | What it buys |
|---|---|---|
| `external_ids JSONB` | league, franchise, nhl_club, player, game, season, transaction_event | Map external identifiers with an `UPDATE`, not a schema change. GIN-indexed on `player` |
| `data_source` enum | every fact table | Distinguish typed, confirmed, parsed, imported, and authoritative data |
| `partner_api` source | pre-registered at authority rank 90 | Authoritative data wins reconciliation on arrival, with no code change |
| `ingest_batch` | all machine-sourced writes | Inspect, reconcile, or roll back a load as a unit; `payload_digest` proves what arrived |
| `superseded_by` | game_result, contract | Backfill without erasing what the league lived through |
| Standard vocabulary | throughout | NHL stat abbreviations, IANA time zones, ISO 3166 country codes, ISO 8601 UTC timestamps |

### Reconciliation procedure (when the feed arrives)

1. Land the raw payload in `ingest_batch` with a digest. Never parse without storing the source.
2. Resolve identity: match on `external_ids` first, then on a deterministic fallback
   (name + birthdate for players, club + window for games). Unmatched rows go to a review queue —
   they are never guessed at.
3. Compare against current rows. Agreement writes nothing but a verification stamp.
   Disagreement writes a new row at `partner_api` authority and supersedes the old one with
   `supersede_reason = 'reconciled against authoritative feed <batch id>'`.
4. Increment `conflict_count` on the batch and show the commissioner a diff before it goes
   live. A league's own record is not silently rewritten by a third party.
5. Views recompute. Standings, caps, and leaders update with no additional work.

The important property: after reconciliation, the league can still see what it believed at the
time and what the feed says now. Both are true statements about different things.

---

## 4. Export contract v1.0.0

One payload shape serves league exports, user backups, and any future partner. Publish it,
version it, and treat breaking changes as a major bump.

```json
{
  "export_schema_version": "1.0.0",
  "generated_at": "2026-09-14T18:00:00Z",
  "league": {
    "id": "0f2c…",
    "name": "Example League",
    "external_ids": {}
  },
  "season": {
    "id": "8b41…",
    "ordinal": 1,
    "label": "Season 1 (NHL 27)",
    "game_title": "NHL27",
    "salary_cap_cents": 8800000000,
    "points_system": { "win": 2, "ot_loss": 1, "reg_loss": 0 }
  },
  "franchises": [
    {
      "id": "c19a…",
      "name": "Example Franchise",
      "club_abbrev": "CHI",
      "gms": [
        { "user_id": "77e2…", "display_name": "…", "from": "2026-09-01T00:00:00Z", "to": null }
      ]
    }
  ],
  "games": [
    {
      "id": "aa10…",
      "week": 6,
      "window": { "opens_at": "2026-10-12T00:00:00Z", "closes_at": "2026-10-19T04:59:00Z" },
      "home": { "franchise_id": "c19a…", "goals": 4 },
      "away": { "franchise_id": "d422…", "goals": 3 },
      "decision": "overtime",
      "status": "confirmed",
      "provenance": {
        "data_source": "confirmed",
        "confidence": 1.0,
        "reported_by": "77e2…",
        "verified_by": "91bd…",
        "verified_at": "2026-10-14T02:11:00Z",
        "ingest_batch_id": null
      },
      "skater_stats": [
        {
          "player": { "id": "5f70…", "full_name": "…", "position": "C", "external_ids": {} },
          "franchise_id": "c19a…",
          "G": 2, "A": 1, "PIM": 0, "SOG": 6, "HIT": 3, "BLK": 1,
          "FOW": 12, "FOL": 9, "plus_minus": 2, "toi_seconds": 1187
        }
      ],
      "goalie_stats": [
        {
          "player": { "id": "3c88…", "full_name": "…", "position": "G", "external_ids": {} },
          "franchise_id": "d422…",
          "SA": 31, "SV": 27, "GA": 4, "toi_seconds": 3612,
          "decision": "L", "shutout": false
        }
      ]
    }
  ],
  "transactions": [
    {
      "id": "b901…",
      "type": "trade",
      "status": "executed",
      "proposed_at": "2026-10-03T15:42:00Z",
      "resolved_at": "2026-10-04T01:09:00Z",
      "reverses": null,
      "assets": [
        { "kind": "player", "player_id": "5f70…", "from_franchise_id": "c19a…", "to_franchise_id": "d422…" },
        { "kind": "draft_pick", "draft_year": 2027, "draft_round": 2, "from_franchise_id": "d422…", "to_franchise_id": "c19a…" }
      ],
      "approvals": [ { "user_id": "91bd…", "vote": true } ]
    }
  ]
}
```

### CSV profile

For commissioners and spreadsheet users, the same data flattens to a stable file set. These are
also the accepted import shapes, so export and import are symmetric:

| File | Grain | Key columns |
|---|---|---|
| `franchises.csv` | one franchise | `franchise_id, name, club_abbrev, gm_handle` |
| `schedule.csv` | one game | `game_id, week, window_opens_at, window_closes_at, home_franchise_id, away_franchise_id` |
| `results.csv` | one game | `game_id, home_goals, away_goals, decision, status, data_source, verified_by` |
| `skater_stats.csv` | one player-game | `game_id, player_id, full_name, franchise_id, G, A, PIM, SOG, HIT, BLK, FOW, FOL, plus_minus, toi_seconds, data_source` |
| `goalie_stats.csv` | one goalie-game | `game_id, player_id, full_name, franchise_id, SA, SV, GA, toi_seconds, decision, shutout, data_source` |
| `transactions.csv` | one asset movement | `txn_id, txn_type, status, proposed_at, resolved_at, asset_kind, player_id, from_franchise_id, to_franchise_id` |
| `standings.csv` | one team-season | `franchise_id, GP, W, L, OTL, PTS, ROW, GF, GA, DIFF` (derived, export-only) |

Rules: UTF-8, RFC 4180 quoting, ISO 8601 UTC timestamps, integer cents for money, empty string
for null. `standings.csv` is never an import target — it is computed.

---

## 5. Indexing and scale notes

A 32-team season is roughly 1,300 games, ~48,000 skater stat rows, and a few thousand
transactions. Even a hundred concurrent leagues is small data; correctness matters far more than
throughput here.

- Partial indexes on `superseded_by IS NULL` keep the hot path narrow as history accumulates
- `game (season_id, window_closes_at)` drives the "what do I owe this week" query, which is the
  single most-requested view in the app
- GIN on `player.external_ids` makes future identity matching cheap
- If standings ever get slow, promote `v_standings` to a materialized view refreshed on result
  confirmation. Do not do this before it is actually a problem

---

## 6. Change log

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-07-22 | Initial data model, provenance framework, and export contract |
