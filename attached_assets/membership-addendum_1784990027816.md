# Front Office — Membership & Commissioner Email (Addendum)

**Doc version:** 1.0
**Amends:** `front-office-v1-spec.md` §3, `PHASE_1_SCOPE.md` (adds Phase 2
checkpoints), `db/schema-membership.sql`
**Phase:** 2 — build after Phase 1 is stable and demoed

Four capabilities, one theme: the **commissioner provisions the whole league up
front** and the platform does the recurring chore of keeping everyone informed.
This is squarely on-thesis — the customer is the commissioner, and every one of
these reduces their labor.

---

## 1. Enforced seat limit

NHL 27 Connected Franchise caps at **32 human GMs**. Front Office makes that a
real limit, not a note in the rulebook.

- `season.max_seats` defaults to 32, configurable down to 2 (a league may run
  16 or 20).
- A database trigger refuses the 33rd seat. This is a hard capacity rule, so it
  is enforced at write time, not caught by a nightly check — the same principle
  the review applied to the active-GM constraint.
- Lowering `max_seats` below current occupancy is blocked by a check (you can't
  strand seats that are already filled); a DQ check catches it if it ever slips
  through.
- The UI shows "24 / 32 seats" everywhere seats appear. The marketplace's "open
  seats" is `max_seats − filled`.

**Why a trigger and not just app logic:** two commissioners (or a commissioner
and an auto-fill from the marketplace) could assign the last seat concurrently.
The trigger closes the race the same way the active-GM index does.

---

## 2. Commissioner self-signup

A commissioner signs up, creates a league, and becomes its `owner` — no
gatekeeping, no waitlist. This is already Checkpoint 2 in Phase 1; the only
addition here is that league creation now also creates the commissioner's own
`league_member` row, so the person who started the league is the first entry on
its roster rather than a special case that lives outside it.

Keep signup frictionless: Discord OAuth, name the league, pick colors, done. The
commissioner is the one user who will evangelize the product to 31 other people
— the first five minutes must feel effortless.

---

## 3. Commissioner-provisioned members

The commissioner adds **everyone** — names, emails, logos — typically before
those people have accounts. This is the feature that makes a league feel real on
day one instead of trickling in over three weeks of invite links.

### The model

`league_member` is the commissioner's roster. It stands on commissioner-entered
details and does **not** require the person to have signed up:

- `display_name` — required
- `email` — optional (PII; see below), used for the invite and the weekly digest
- `logo_url` — member/team avatar, re-encoded on upload per `replit.md` rule 12
- `gamertag`, `relationship_tier` — see §4
- `user_id` — **NULL until the person signs up and claims their invite**

When the person claims their invite (or signs up with a matching email), their
`app_user` links to the existing `league_member` row, and a `league_membership`
is created. Nothing is duplicated; the commissioner's roster and the real user
become one record.

### Bulk entry

Commissioners think in rosters, not forms. Support:
- A paste-a-list / CSV import (name, email, gamertag per row).
- Inline add for one-offs.
- Idempotent on `(league_id, email)` — re-importing the same list updates rather
  than duplicates.

### Email is PII — handle it as such

A provisioned email is exactly the PII the threat model warns about, and it's
entered by someone *other than its owner*, which raises the bar:

- Never shown on a public page. `visibility: public` never exposes the roster.
- Never written to logs.
- Used only through `v_email_audience` for delivery.
- Honors `email_opt_in`. A member who opts out is removed from the audience view
  in one place, so opt-out can't be forgotten in an ad-hoc query.
- Minimized: store the email, not a contact history. No phone, no address.

A commissioner entering a colleague's email to run a hockey league is ordinary
and fine; the platform's job is to hold it responsibly, not to broadcast it.

---

## 4. Relationship tiers — friend / VIP / stranger

Each member carries a tier that is **the commissioner's private read** on that
person. It exists to make communication warmer and triage easier — nothing more.

### What it is for

- Mail-merge tone. The weekly email can address friends casually and strangers
  formally using the same template.
- Triage. A commissioner chasing an unplayed game knows at a glance whether this
  is a close friend they can needle or a new stranger they should be gentle with.
- Onboarding attention. New strangers might get a warmer welcome; VIPs (a league
  veteran, a sponsor, a draw who brings others in) might get a heads-up first.

### What it is emphatically NOT

- **Not visible to the member it describes.** A person is never told they're a
  "stranger." The tier is commissioner-only, exposed solely through
  commissioner-scoped endpoints. There is deliberately no public or member-facing
  view that selects it.
- **Not a privilege level.** It never gates a seat, a vote, a trade, or any
  gameplay. The enum order (friend > vip > stranger) is familiarity, not rank.
- **Not a profile.** It's a single courtesy hint the commissioner sets, not an
  inferred score and not a behavioral dossier. The platform never computes or
  suggests a tier; only the commissioner sets it.

Default is `stranger` so nothing is presumed about a freshly added member.

Handled this way, it's a friendly organizational tool. The guardrails above are
what keep it from curdling into something that feels like ranking your friends —
so keep them.

---

## 5. Automatic weekly commissioner email

A digest that goes out every week without the commissioner lifting a finger, and
that they can rewrite whenever they like.

### Template — editable and versioned

`email_template` holds one active `weekly_commissioner` template per league,
versioned bylaws-style so an edit never destroys the previous wording. The
commissioner edits subject, body, send day, and send hour (in the league's
timezone).

The body is markdown with an **allowlisted** set of mail-merge tokens resolved
at send time:

| Token | Renders |
|---|---|
| `{{league_name}}` | The league name |
| `{{week_number}}` | Current week |
| `{{standings_top5}}` | Top five, from `v_standings` |
| `{{games_due}}` | Unplayed games whose window closes this week |
| `{{open_seats}}` | `max_seats − filled`, with marketplace link |
| `{{recent_transactions}}` | The week's wire |
| `{{member_first_name}}` | Per-recipient first name |
| `{{impact_total}}` | Receipted giving, if the charity layer is on |

Anything not on the allowlist renders literally — no arbitrary expression
evaluation in a user-authored template (that's a template-injection footgun).
Provide a **live preview** against this week's real data, and a "reset to
default" that restores the starter template.

### Composition — confirmed data only

The digest is composed from the same derived views as everything else, which
means **confirmed results only**. A weekly email must never report an
unconfirmed score as fact — it would put the platform's name behind a number two
GMs haven't agreed on. `{{games_due}}` is exactly the nudge that gets those
confirmations to happen, so the email actively improves the data it's built from.

### Sending — idempotent and auditable

- A scheduled job wakes hourly and finds templates whose local send time has
  arrived this week.
- `email_send` records one row per league per week, `UNIQUE (league_id, kind,
  period_start)` — a scheduler double-tick or a retry **cannot** mail a league
  twice.
- The send goes through the **outbox**, not an inline API call, so a failure to
  reach the ESP never half-commits and can retry cleanly.
- `rendered_subject` / `rendered_body` snapshot exactly what went out, so "what
  did last week's email say" is answerable forever.
- Optional `require_approval`: the commissioner gets a preview to approve before
  send, or leaves it fully automatic.
- Every recipient email is transactional-category with a working unsubscribe
  that flips `email_opt_in` — even a league digest must honor opt-out to stay on
  the right side of anti-spam law (CAN-SPAM / CASL).

### Deliverability, briefly

Use a real ESP (Resend, Postmark, SES) with SPF/DKIM/DMARC on the sending
domain. Do not send league mail from a bare app server — it lands in spam and
burns the domain. This is an ops decision to make before the first send, not
after the first bounce report.

---

## 6. Checkpoints (Phase 2 additions)

Fold these into the Phase 2 sequence, after the transaction wire and cap ledger.

### Checkpoint 7 — Membership provisioning

**Build**
- `season.max_seats` + the seat-limit trigger; "N / max" seat counts in the UI
- `league_member` CRUD: inline add, bulk paste/CSV import, edit, soft-delete
- Logo upload through the hardened path (allowlist, re-encode, size cap)
- Invite flow: token generated, emailed, claimed → links `user_id`, creates
  `league_membership`, rotates the token
- Commissioner's own `league_member` row created at league creation

**Acceptance**
- The 33rd seat is refused by the database, surfaced as a clean 409, not a 500
- A member added by email, who later signs up with that email, ends up as one
  linked record — no duplicate
- Re-importing the same CSV updates rather than duplicates
- A member email never appears in any public response or any log line
- A logo uploaded as an SVG-with-script is rejected or rendered inert

### Checkpoint 8 — Relationship tiers

**Build**
- Tier selector on each member (default stranger), commissioner-only
- Tier surfaced in the commissioner's roster view and usable as a mail-merge
  input

**Acceptance**
- No non-commissioner endpoint returns `relationship_tier` — proven by a test
- A member viewing their own profile cannot see their tier
- Tier changes nothing about what any member can do in the league

### Checkpoint 9 — Weekly commissioner email

**Build**
- `email_template` editor: subject, body with allowlisted tokens, schedule,
  timezone, live preview against real data, reset-to-default
- Hourly scheduler → composes from derived views → enqueues via outbox
- `email_send` idempotency; snapshot of rendered output; optional approval
- ESP integration with SPF/DKIM/DMARC; working unsubscribe → `email_opt_in`

**Acceptance**
- Running the scheduler twice for the same week sends exactly one email
- The preview matches what actually sends, byte for byte
- An unknown `{{token}}` renders literally, does not execute, does not error
- Unsubscribe removes the member from `v_email_audience` immediately
- The email reports no unconfirmed result as a final score

---

## 7. What not to do

- **Don't infer or suggest relationship tiers.** The commissioner sets them; the
  platform never guesses. An inferred "stranger" score is the exact thing that
  turns a courtesy hint into something that feels like surveillance.
- **Don't expose the roster or tiers publicly**, ever, under any visibility
  setting.
- **Don't send from the app server.** ESP with authenticated domain, or don't
  send.
- **Don't let templates evaluate arbitrary expressions.** Allowlisted tokens
  only.
- **Don't skip the unsubscribe** because "it's just a league email." The law
  doesn't carve that out, and neither should you.
