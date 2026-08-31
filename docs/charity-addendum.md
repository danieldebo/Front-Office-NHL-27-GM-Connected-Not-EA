# Front Office — Charity Layer (Addendum)

**Doc version:** 1.0
**Amends:** `front-office-v1-spec.md` §7, `front-office-architecture.md` §12
**Companion:** `schema-charity.sql`

---

## 1. The tension this has to resolve

The v1 spec says, plainly, do not process league dues or prize pools. That was the right call
and it stays the right call. Charity looks like it breaks that rule.

It doesn't, if the platform observes one line:

> **Front Office records giving. It never moves money.**

This is the same rule already applied to the salary cap. Cap hits are modeled in integer cents,
computed, validated, and displayed — and no dollar ever passes through the system. Charity works
identically. Front Office computes what was pledged, records the receipt that comes back from a
donation platform, and displays the result. Funds go directly from the donor to a processor that
is already built and regulated for it.

Everything downstream follows from that line.

---

## 2. Use CauseFully as the giving layer

The obvious move is to point this at CauseFully rather than build a second donation stack.

The fit is unusually clean, and not just because both are yours. CauseFully's premise —
**real needs, real receipts** — is the same premise as the provenance model in this platform. A
donation receipt is structurally identical to a confirmed game result: an external fact, with an
authority ranking, that supersedes anything a user merely claimed. The trust architecture
already exists here; charity just plugs into it.

| Concern | Owner |
|---|---|
| Cause catalog, vetting, tax status | CauseFully |
| Payment processing, receipts, tax documentation | CauseFully / its processor |
| Pledge definition and computation | Front Office |
| Attribution to a franchise, season, and game | Front Office |
| Public display of impact | Both |

Front Office holds a `cause_ref` (an external CauseFully cause ID) and a `donation_receipt`
(an external receipt ID plus amount). Nothing else about money lives in this database.

There is a real cross-promotion argument too: a league of 32 people that gives together all
season is a far better acquisition channel for a micro-philanthropy platform than an ad, and a
charity layer gives Front Office a story that no competing league tracker has.

---

## 3. Mechanics that fit hockey, ranked by how well they work

### 3.1 Franchise cause — adopt one, keep it forever

Each franchise picks a cause when it's founded. It persists across seasons the same way the
banner and the records do, because it attaches to `franchise`, not `team_season`. When a GM
leaves and a new one takes the seat, the cause carries — it becomes part of what the franchise
*is*, not a preference of whoever is currently running it.

This is the whole feature in miniature: charity becomes an identity layer on the continuity
layer you already built.

### 3.2 Performance pledges

A GM pledges an amount per goal, per win, or a flat amount per season. The platform computes the
running total from **confirmed results only** — unconfirmed and screenshot-parsed results are
excluded, because inflated giving numbers would be worse than none. The math is derived, so a
corrected score corrects the pledge automatically, which is exactly why the append-only model
was worth the trouble.

Pledges are capped at declaration, so nobody wakes up owing four hundred dollars because their
first line caught fire in March.

### 3.3 Accountability giving — the sleeper feature

Miss your game window, donate five dollars.

This is the most interesting mechanic in the list because it solves a *product* problem, not a
charity problem. Enforcement is the ugliest part of running a league: strikes, suspensions,
public shaming, commissioners playing bad cop with their friends. Nobody enjoys it and it drives
people out.

Converting the penalty into a donation changes the entire emotional register. The person who
ghosted a game isn't being punished, they're contributing. The commissioner isn't disciplining a
friend, they're pointing at a rule everyone agreed to. And the league accumulates something it's
proud of out of its own worst behavior.

Set by the league, opt-in per season, capped. Never automatic and never charged — it produces a
prompt, not a transaction.

### 3.4 Champion's choice

The season champion directs the league's pooled giving to a cause of their choosing. This
quietly solves the prize problem from the very first conversation: leagues want stakes, cash
prizes create money-handling and gambling exposure, and "you decide where the pot goes" is a
genuinely coveted prize that carries neither.

Add the winner and their chosen cause to the Hall of Fame page. That record is more durable than
a payout.

### 3.5 Impact banner

Cumulative receipted giving displayed in the rafters alongside championships, per franchise and
per league. It's the same visual language as the mockup, and it makes a three-season league's
public page substantially harder to walk away from.

### 3.6 League Wrapped

CauseFully already has a Spotify-Wrapped-style recap. A season-end recap that combines a GM's
hockey season *and* their impact — goals, trades, that one 6–5 overtime disaster, and what it
all added up to — is a single shareable artifact that recruits for both products at once. Ship
it the week the season ends, when everyone is still paying attention.

### 3.7 Corporate matching

Once giving is real and receipted, matching becomes the sponsor pitch. "We match every dollar
this league gives" is dramatically easier to sell than a logo on a standings page, and it makes
the sponsorship tiers from the original branding conversation actually mean something.

---

## 4. Compliance — read this part twice

The natural instinct here is a 50/50 raffle, because that *is* the hockey charity institution.
Don't, or at least don't casually.

**Raffles and 50/50s are charitable gaming.** In the United States they're regulated
state-by-state: licenses, registration, eligibility restrictions on who may conduct them, record
retention requirements, and in a number of states outright prohibition of online sales or
interstate participation. A 32-person league spanning a dozen states cannot run a compliant
online 50/50 by accident, and "it's for charity" is not a defense.

**Buy-in pots with cash prizes** raise separate questions about games of chance versus skill,
which also vary by jurisdiction. This is precisely why the original spec kept prize money out.

The safe posture, and the one built into the schema:

1. **No pooling.** Money never sits in a Front Office account, or in any account controlled by
   the league, waiting to be distributed. Each donation goes directly from an individual donor to
   the cause through CauseFully.
2. **No chance element.** Nothing is raffled, drawn, or won. Champion's choice awards a
   *decision*, not a pot.
3. **No consideration for entry.** Giving is never required to join a league or a seat.
4. **Receipts come from the processor**, never generated by Front Office.
5. **Nothing is auto-charged.** Every mechanic produces a prompt the person acts on.

If a league genuinely wants a raffle, the answer is to point them at a licensed charitable
gaming provider and stay out of it entirely. That's a link, not a feature.

Two smaller items worth handling early: charities must be vetted for legitimate tax-exempt
status (CauseFully's job, but verify the vetting exists), and the platform needs a
content-moderation path for cause selection so that "charity" can't be used as a vector for
something you'd rather not host.

---

## 5. Claimed versus receipted — the single most important design decision

A GM who pledges and doesn't follow through is worse for the league than a GM who never pledged.
Public giving numbers that turn out to be aspirational would poison the whole feature.

So the platform tracks two separate quantities and never blurs them:

| | Meaning | Where it shows |
|---|---|---|
| **Committed** | Computed from confirmed results and a declared pledge | GM's own dashboard, commissioner view |
| **Receipted** | Confirmed by an external donation receipt | Everywhere public — banners, league totals, Wrapped |

**Public totals are receipted only.** Committed is a private accountability number, visible to
the person who owes it and the commissioner, and nowhere else.

This is the provenance model applied to money: `claimed` is the lowest authority tier,
`receipted` outranks it, and a receipt from the payment processor supersedes anything a user
asserted — exactly as `partner_api` outranks `manual` for game results. The data quality suite
gets two new assertions: receipted totals may never exceed processor-confirmed sums, and pledges
committed but unfulfilled after 30 days raise an ALERT to the GM, not a public flag.

---

## 6. What this changes elsewhere

| Doc | Change |
|---|---|
| `front-office-v1-spec.md` §3 | Add franchise cause selection to league setup; add giving to the public league page |
| `front-office-v1-spec.md` §7 | Monetization unchanged. Giving is not revenue and must never be treated as such — no platform fee on donations, ever |
| `front-office-architecture.md` §12 | "No payment processing" stands, restated as "no payment processing, and no fund custody" |
| `openapi.yaml` | Add read-only giving endpoints; a webhook receiver for donation receipts from CauseFully at `partner_api` authority |
| `schema.sql` | Extended by `schema-charity.sql` |
| Data quality suite | Two new ALERT checks (§5 above) |

Phase placement: this is **Phase 3** work, alongside the marketplace and franchise history. It
needs confirmed results and a live franchise model to compute against, and it needs leagues that
already trust the platform with their season before it asks them to trust it with their giving.

---

## 7. One caution

The mechanics above work because they're small, voluntary, and woven into things the league is
already doing. The failure mode is making the platform feel like it's soliciting.

Keep it opt-in at the league level, keep it invisible for leagues that decline, never gate a
feature behind giving, and never take a cut. The moment a GM suspects the charity layer exists
to benefit the platform, it stops working — and unlike a feature that merely underperforms, this
one takes the platform's credibility with it.
