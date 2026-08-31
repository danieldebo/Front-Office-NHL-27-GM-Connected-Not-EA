# Front Office — Discovery, Ranking, Waitlist & Footer (Addendum)

**Doc version:** 1.0
**Amends:** `front-office-v1-spec.md` §3, `db/schema-discovery.sql`, `replit.md`
**Phase:** 3 (discovery/marketplace phase)

Five things: a public **open-leagues** page, a **sign-up** flow, a self-reported
**Ranked Division**, a **private admin skill rating** the rated person never
sees, a league **waitlist**, and a persistent **footer**. One of these — the
hidden rating — carries real ethical weight and gets the most careful treatment
below. Read §3 before building it.

---

## 1. The open-leagues page

A public directory of leagues that have opted in to recruiting. This is the top
of the funnel: it's how a stranger with NHL 27 finds a league to join, and it's
the same discovery surface the GM marketplace already needed.

- Served from `v_open_leagues` — listed leagues only, with live seat and
  waitlist counts, platform, competitiveness, and the recruiting blurb.
- **Carries nothing private.** No emails, no admin ratings. It's safe for a
  signed-out visitor, and the view is built so that's true by construction.
- Filter/sort by platform, competitiveness, seats open, waitlist length, and
  league health (from `v_league_health`). A prospect should be able to find "an
  active, well-run, competitive PSN league with an open seat" in one screen.
- Each card shows: name, logo, blurb, "3 of 32 seats · 5 on waitlist," health,
  and either **Sign up** (seats open) or **Join waitlist** (full).

Discovery is separate from visibility. `league.visibility` controls whether a
league's *pages* are viewable; `league_listing.is_listed` controls whether it
*advertises for members*. A league can be public but not recruiting, or
recruiting but unlisted (shared by direct link only).

---

## 2. Sign-up & Ranked Division

### Sign-up

A prospect hits **Sign up** and submits: their platform, timezone, an optional
message to the commissioner, an optional preferred club, and their **Ranked
Division**. That creates a `league_signup`. If a seat is open and the league
auto-accepts, it can convert to a placement; otherwise the commissioner reviews
it, or it drops onto the waitlist.

### Ranked Division — self-reported, player-visible

Bronze → Silver → Gold → Diamond → Platinum → Elite → Ultimate. Seven brackets,
low to high, that a **player picks for themselves** — a matchmaking-style rank,
not a judgment imposed on them.

- Lives on `app_user.ranked_division`, editable by the player any time.
- A sign-up can also carry a per-application `stated_division` (a player's level
  drifts; a league may ask "what are you at now").
- Shown on the applicant's sign-up and on the commissioner's roster so a league
  can gauge fit and balance.
- `league_listing.suggested_division` lets a league say "we're a
  Diamond+ league" as **guidance, not a gate**. The platform never
  auto-rejects a Bronze applicant to a Diamond league — that's the
  commissioner's call, and plenty of leagues welcome a mismatch.

Because it's self-reported and self-visible, it's low-sensitivity: it's a person
describing themselves, which they're always allowed to do.

---

## 3. The private admin skill rating — handle with care

An admin can privately rate how a person actually plays, 1–10, **and the rated
person never sees it.** This is a genuinely useful league-balancing tool, and it
is also the single most sensitive thing in the entire platform, because it is one
person's hidden judgment of another. Build it with the guardrails, not around
them.

### What it's for

Balancing leagues and placing waitlisted people sensibly. Self-reported division
is aspirational and gameable; an admin who has actually played against someone
has a truer read. Keeping that read private lets admins be honest without
creating conflict ("why did you rate me a 4?") every time.

### The hard boundaries — all enforced, not aspirational

1. **The rated user never sees it.** No endpoint the subject can reach returns
   it. Not their profile, not their sign-up status, not an error message, not an
   API field that happens to be null for them and populated for admins. This is
   why it lives in a standalone `admin_skill_rating` table and never as a column
   on `app_user` — so `SELECT * FROM app_user` can't leak it and no applicant
   view can accidentally join it.
2. **Never public, never exported, never emailed, never logged.** It is
   Internal-class at most (see `docs/threat-model.md`) and arguably should be
   treated as the most restricted Internal data you hold.
3. **Never automated.** The platform never *infers* a rating, never suggests one,
   and never uses it to **auto-reject or auto-rank** anyone. It is advisory to a
   human admin making a human decision. An algorithm silently ranking people by a
   hidden score is exactly what this must not become.
4. **Scoped to a league, not global.** A rating is given by an admin within their
   league. It does not follow a person around the platform as a permanent secret
   score. A new league starts with no opinion of you.
5. **Attributable.** `rated_by` is recorded. If this is ever misused, there's a
   trail. Ratings are not anonymous even though they're private.

### Access, concretely

Exposed through exactly one admin-scoped endpoint pattern (e.g.
`GET /leagues/{id}/applicants?include=rating`, admin role required), which joins
`admin_skill_rating` explicitly. Everywhere else in the codebase, the table is
untouched. The CI PII/exposure check should assert no user-facing view or
serializer references it.

### A word on why the guardrails matter

A hidden number that scores people is the kind of feature that's fine when it's a
commissioner jotting "solid, 7/10, good teammate" and corrosive when it quietly
becomes the thing that decides who gets in. The boundaries above are what keep it
the former. If a future request is "auto-sort the waitlist by admin rating," that
's the moment to push back — the value of the tool is that a human stays in the
loop.

---

## 4. Waitlist

When a league is full, a prospect joins its waitlist instead of signing up for a
seat.

- `waitlist_entry` is an ordered queue per league. Order is `position` (sparse
  integers) so a commissioner can move someone up without rewriting the whole
  list — and without lying about `joined_at`.
- When a seat opens, the commissioner invites the next appropriate person (order
  is a guide; the self-reported division and the private rating inform the
  human's pick — the platform doesn't auto-pick). The invite **expires**
  (`invite_expires_at`) so the queue keeps moving if someone's gone quiet.
- Statuses: `waiting → invited → placed | declined | withdrawn | expired`.
- A person holds at most one waitlist spot per league. Placing them anywhere
  resolves it; a DQ check catches a placed person still marked `waiting`.
- The prospect sees their own position ("you're 3rd on the waitlist") — that's
  their own data and it's motivating. They never see anyone else's rating or the
  admin's reasoning.

This is the same insight as the GM marketplace: a ghosted seat is a two-day
vacancy instead of a league-killer, and a warm waitlist is how you fill it fast.

---

## 5. Persistent footer

A site-wide footer on every page:

> **Created by DeBo.** If this saved you a spreadsheet, a $1 tip keeps it running
> → Venmo **@theedebo**

- Persistent across the whole app (public and signed-in), part of the root
  layout, not a per-page element.
- The Venmo handle links out to `https://venmo.com/theedebo` (or the Venmo app
  deep link on mobile). It is a plain external link — **the platform does not
  process this payment.**
- Keep it modest and genuine, matching the product's voice: a builder's tip jar,
  not a paywall or a nag. One line, unobtrusive, always there.

### Why this doesn't break the "no money movement" rule

The platform's hard rule (rule 5) is that Front Office never moves *other
people's league money* — no dues, no pools, no prize custody, no processing.
A creator tip jar is categorically different: it's a voluntary, direct,
peer-to-peer payment from a user to the creator, on Venmo's rails, that never
touches the platform's code or accounts. The platform links; Venmo handles the
money. That's a link, not a payment system, and it's fine.

(If it ever grew into "pay to unlock features," that would cross back into
processing and would need real payment infrastructure and terms. A tip link is
not that.)

---

## 6. Checkpoints (Phase 3 additions)

Fold in alongside the marketplace and franchise-history work.

### Checkpoint 13 — Open leagues & sign-up

**Build**
- `league_listing` config on the commissioner side (list / accept signups /
  accept waitlist / blurb / competitiveness / suggested division)
- Public open-leagues page from `v_open_leagues`, filterable, signed-out safe
- Sign-up flow creating `league_signup` with self-reported division
- `app_user.ranked_division` editable in profile

**Acceptance**
- A signed-out visitor sees listed leagues and no private data whatsoever
- Signing up creates a reviewable applicant for the commissioner
- Suggested division is shown as guidance and never auto-rejects anyone

### Checkpoint 14 — Waitlist

**Build**
- Join-waitlist when a league is full; ordered queue; own-position visible to
  the prospect
- Commissioner reorder, invite (with expiry), place/decline
- Auto-resolve on placement; expiring invites free the spot

**Acceptance**
- A person can hold only one spot per league
- Reordering doesn't corrupt positions (deferred unique holds) or rewrite
  `joined_at`
- An expired invite is caught and the queue continues
- A placed person is never left `waiting`

### Checkpoint 15 — Private admin rating

**Build**
- Admin-only rating (1–10 + private note) on an applicant/member, in the
  admin-scoped applicant view only
- The rating table referenced by exactly one admin endpoint; nowhere else

**Acceptance**
- **The rated user cannot retrieve their rating by any route** — profile, API,
  applicant status, error payload. Proven by explicit tests from the subject's
  session.
- The rating never appears in exports, emails, logs, or public views
- The platform never sets or suggests a rating on its own
- Removing a rating leaves no residue in any user-facing surface

### Checkpoint 16 — Persistent footer

**Build**
- Root-layout footer: "Created by DeBo," $1 suggestion, Venmo @theedebo external
  link, on every page

**Acceptance**
- Present on public and authenticated pages alike
- The Venmo link opens externally; the app processes nothing
- Accessible (real link semantics, visible focus), unobtrusive on mobile

---

## 7. What not to do

- **Don't auto-reject or auto-rank by any score** — self-reported division or
  private rating. Both inform a human; neither decides.
- **Don't ever surface the admin rating to the person it describes**, in any
  form, including "why were you declined."
- **Don't put private data on the open-leagues page.** It's signed-out territory.
- **Don't turn the tip footer into a paywall or a nag.** One honest line.
- **Don't route the tip through the platform.** It's an external Venmo link, full
  stop — the no-money-movement rule stays intact.
