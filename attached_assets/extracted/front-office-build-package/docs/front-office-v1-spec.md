# Front Office — v1 Product Spec

**Doc version:** 1.0
**Status:** Draft for review
**Owner:** Daniel DeBosschere
**Applies to:** NHL 27 Connected Franchise (online-only, up to 32 human GMs)

---

## 1. Thesis

NHL 27 gives leagues a place to *play*. It does not give them a place to *exist*.

Connected Franchise ships without persistent history across game years, without recruiting
tools, and without anything resembling a front office paper trail. Every league that forms in
September solves those problems the same way: a Discord server, a Google Sheet, and one
exhausted commissioner.

Front Office is the layer underneath the game. Leagues play in NHL 27; their schedule,
standings, contracts, trades, records, and franchise history live here — and carry forward
into NHL 28, 29, and 30.

**The customer is the commissioner.** Everyone else joins because the commissioner already did.
Every v1 decision optimizes for reducing commissioner labor.

**The moat is accumulated history.** A league with one season on the platform can leave. A league
with four seasons of franchise records, retired numbers, and a trade ledger cannot.

---

## 2. Who it is for

| Role | What they need | How often they show up |
|---|---|---|
| Commissioner | Setup, schedule generation, enforcement, dispute resolution, roster legality | Daily during season |
| GM | My record, my next game, my cap space, what just happened | 2–4x per week |
| Prospective GM | An open seat in an active, well-run league | Once, then converts |
| Spectator / streamer | A public page worth linking | Passively |

---

## 3. v1 scope

### In scope

**Must ship**

1. **League creation & configuration**
   - League name, branding (logo, two colors), visibility (public / unlisted)
   - Season settings: game title, salary cap, roster minimums/maximums, games per matchup,
     point system (2-1-0 vs 3-2-1-0), tiebreaker order
   - Rulebook as versioned markdown with a visible changelog — bylaws are a document with
     revision history, not a pinned Discord message

2. **Membership & seats**
   - Invite links, join requests, commissioner approval
   - Seat = a franchise slot. Seats are assignable, revocable, and transferable
   - GM history is retained on the seat: when a GM is replaced, the franchise keeps its record
     and the departing GM keeps their personal career stats

3. **Schedule**
   - Generate a balanced schedule from divisions + games-per-opponent
   - Matchup *windows* rather than fixed times (e.g. "Week 6: Mon–Sun"), because coordinating
     32 humans across time zones on exact clock times fails
   - Per-GM availability grid; the app surfaces overlap for each matchup
   - Deadline enforcement: unplayed games at window close resolve per league policy
     (postpone / forfeit / commissioner sim), logged with reason

4. **Result & stat entry**
   - Commissioner or either GM submits a final score; the opposing GM confirms
   - Optional box score entry: skaters (G, A, PTS, +/-, PIM, SOG, HIT, BLK, FOW/FOL, TOI),
     goalies (SA, SV, GA, SV%, TOI, decision, SO)
   - Disputed results flag to the commissioner and never silently overwrite
   - **Every stat row records where it came from.** See §5

5. **Standings & leaderboards**
   - Standings are *derived*, never stored as editable numbers. Recompute from game results
     on demand so a corrected result corrects everything downstream automatically
   - League leaders by stat category; franchise all-time records

6. **Transaction wire**
   - Trade proposal → counterparty accept → approval (commissioner or elected committee)
     → execution
   - Signings, waivers, call-ups, IR moves
   - Append-only. A reversed trade is a *new* reversing entry, not a deletion
   - Public wire feed per league; this is also the league's social object

7. **Cap & contract ledger**
   - Per-team cap hit, space, roster count, contract expiries
   - Legality warnings surfaced to both the GM and the commissioner before a move executes

8. **Public league page**
   - Standings, schedule, wire, and franchise history at a shareable URL
   - This is the acquisition channel. Every league that shares its page recruits for you

**Should ship if time allows**

9. **GM marketplace** — open seats listed across all public leagues, filterable by platform,
   time zone, competitiveness, and league health score. This is the highest-leverage feature in
   the whole product: it converts the single biggest league-killer (a ghosted GM) from a death
   spiral into a two-day vacancy. Ship it the moment core league management is stable.

10. **Health score** — activity index per league (games played on time, transaction volume,
    active GMs). Publicly visible. Makes the marketplace trustworthy and gives commissioners a
    reason to keep the league tidy.

### Out of scope for v1

- Payment processing of league dues or prize pools. Handling other people's money invites
  regulatory and dispute burden that has nothing to do with the product. Leagues can settle
  externally; you can add a *ledger* for buy-ins later without ever touching funds
- Live game integration of any kind
- Mobile native apps (responsive web is enough)
- Automated screenshot parsing — see §4, this is the v2 headline feature
- In-app video/voice
- Draft room (season 1 leagues inherit real NHL rosters; drafts matter from season 2 onward)

---

## 4. The data entry problem

There is no public API and no data export from NHL 27. This is the central engineering
constraint and it should drive the roadmap rather than be discovered halfway through it.

**v1 — Manual entry, made cheap.**
Score-only entry takes under ten seconds and is the default. Box score entry is optional and
per-league. Design the form for a phone held in one hand right after a game ends, because that
is when it will actually happen.

**v2 — Screenshot ingest.**
GM uploads the post-game summary screen; a vision model parses it into a structured box score;
the GM confirms a pre-filled form rather than typing one. This is the feature that makes the
product feel like magic instead of like a spreadsheet with a logo. Parsed rows are marked
lower-confidence and are always human-confirmed before they count.

**v3 — Structured import.**
CSV import for commissioners migrating from spreadsheets, and a documented ingest endpoint.

**v4 — Authoritative feed.**
If EA ever exposes league data, it lands through the same ingest pipeline as everything else.
See §5.

---

## 5. EA-export readiness

Assume that at some point an authoritative data feed appears — an EA export, a partner API, or
a community-reverse-engineered stream. The platform should be able to absorb it without a
migration project and without destroying the history it already has.

Five design commitments make that true. They cost almost nothing now and are extremely
expensive to retrofit:

1. **Every mappable entity carries an `external_ids` JSONB column** from day one — leagues,
   franchises, clubs, players, games. Mapping an EA identifier later is an UPDATE, not a schema
   change.

2. **Every fact records its provenance.** Results, stats, and transactions carry
   `data_source` (`manual` / `confirmed` / `ocr` / `csv_import` / `partner_api`),
   `ingest_batch_id`, `confidence`, and `verified_by`. When an authoritative source arrives,
   you can reconcile against it and *see* exactly which rows disagree, instead of guessing.

3. **Authority is ranked, not assumed.** A higher-authority source supersedes a lower one by
   writing a new row and marking the old one superseded. Nothing is overwritten in place. A
   league's history stays legible even after a mass backfill.

4. **Derived values are never stored as editable state.** Standings, cap hits, and leaderboards
   are computed from the event log. Corrections propagate for free.

5. **The export contract is written before it is needed.** A versioned JSON schema plus a CSV
   profile, documented and stable, so "EA wants the data" is a switch rather than a project.
   Same schema serves your own backups, league exports, and any future partner.

**Vocabulary:** use official NHL stat abbreviations and league-standard structures throughout.
UTC timestamps in ISO 8601, ISO 3166 country codes, no bespoke enums where a public standard
exists. The cheapest way to be integration-ready is to already speak the same language.

---

## 6. Build order

| Phase | Ships | Why this order |
|---|---|---|
| 0 | Schema, auth, league + season + seat CRUD | Everything else depends on the seat model being right |
| 1 | Schedule generation, availability, score entry with confirmation, derived standings, public league page | This alone replaces the spreadsheet. Ship it before September |
| 2 | Transaction wire, cap/contract ledger, approval workflow, audit trail | This is what makes it a *front office* instead of a scoreboard |
| 3 | GM marketplace, health score, franchise history and records | This is what makes it a *network* instead of a tool |
| 4 | Screenshot ingest, CSV import, export API | This is what makes it defensible |

Phase 1 is the only phase with a hard date. NHL 27 launches in September and leagues form in
the two weeks around launch. A league that starts its season on a Google Sheet will not migrate
mid-season.

---

## 7. Monetization

- **Free:** up to 12 seats, one active season, public league page, core scheduling and standings
- **Commissioner Pro (monthly, paid by one person):** unlimited seats, custom branding and
  domain, box score stats, cap ledger, exports, historical seasons
- **Network sponsorship:** placement on public league pages and the marketplace, sold once you
  have real numbers from season one
- **Never:** taking a cut of league dues or prize pools

The pricing insight is that the commissioner is doing unpaid labor for 15–31 other people and is
the one person in the league with a strong motive to pay to make it stop. Price to that, not to
the roster.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Manual entry friction kills adoption | Score-only default; box scores opt-in per league; phone-first form |
| Cold start — no leagues, no marketplace | Recruit 5–10 commissioners personally before launch; seed the marketplace with their open seats |
| Connected Franchise itself underdelivers and leagues never form | The platform is game-agnostic by design; the schema has a `game_title` field for a reason. It works for NHL 28, and for other titles |
| EA ships equivalent tooling | Unlikely to include cross-year persistence or cross-league recruiting, which is where the value concentrates |
| Commissioner disputes escalate to you | Enforcement is configuration, not arbitration. The platform never decides, it only records |
| Trademark exposure | Use no EA or NHL marks in branding; user-uploaded club logos stay user-uploaded |

---

## 9. Open questions

1. Does the league own the franchise, or does the GM? Determines whether a departing GM takes
   their record with them. Recommendation: the franchise owns the record, the GM owns a career
   line. Both are true and both should be visible.
2. Point system defaults — 2-1-0 matches the real NHL; 3-2-1-0 rewards regulation wins and
   reduces overtime coasting. Make it configurable, default to NHL.
3. How aggressive should the health score be? Publicly scoring leagues is powerful for
   recruiting and uncomfortable for the commissioners being scored.
4. Should GM career stats be portable across leagues? Powerful for retention, complicated for
   integrity.
