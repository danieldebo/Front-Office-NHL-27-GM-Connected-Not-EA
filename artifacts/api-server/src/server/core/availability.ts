/**
 * server/core/availability.ts — pure availability overlap computation
 *
 * No database access, no Express imports.
 *
 * Each GM records which day-of-week + time-block combinations work for them,
 * stored against their IANA timezone. Given two GMs' grids and a game's weekly
 * window, this module finds the UTC intervals where both are available and
 * returns them formatted in each GM's local timezone.
 *
 * Time blocks (local time):
 *   morning   06:00 – 12:00
 *   afternoon 12:00 – 18:00
 *   evening   18:00 – 22:00
 *   night     22:00 – 02:00 next day  (stored as hours 22–26)
 *
 * Day-of-week: 0 = Sunday, 6 = Saturday (standard JS convention).
 */

export interface AvailabilitySlot {
  /** 0 = Sunday, 6 = Saturday */
  dow: number;
  block: "morning" | "afternoon" | "evening" | "night";
}

export interface GmAvailabilityInput {
  timezone: string;
  slots: AvailabilitySlot[];
}

export interface TimeRange {
  startUtc: Date;
  endUtc: Date;
}

export interface OverlapWindow {
  startUtc: Date;
  endUtc: Date;
  gm1Local: { label: string; timezone: string };
  gm2Local: { label: string; timezone: string };
}

export interface OverlapResult {
  hasOverlap: boolean;
  overlaps: OverlapWindow[];
}

// Local-time hour bounds for each block (end may exceed 24 for night wrapping)
const BLOCK_HOURS: Record<AvailabilitySlot["block"], [number, number]> = {
  morning:   [6,  12],
  afternoon: [12, 18],
  evening:   [18, 22],
  night:     [22, 26],
};

/**
 * Compute UTC offset in milliseconds for a timezone at a given instant.
 * Positive means local is ahead of UTC (e.g. UTC+5 → +18000000).
 */
function getOffsetMs(timezone: string, date: Date): number {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(date);

  const toUtcMs = (parts: Intl.DateTimeFormatPart[]): number => {
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return Date.UTC(
      parseInt(p["year"] ?? "0"),
      parseInt(p["month"] ?? "1") - 1,
      parseInt(p["day"] ?? "1"),
      parseInt(p["hour"] ?? "0") % 24,
      parseInt(p["minute"] ?? "0"),
      parseInt(p["second"] ?? "0")
    );
  };

  return toUtcMs(fmt(timezone)) - toUtcMs(fmt("UTC"));
}

/**
 * Get the local day-of-week (0=Sun, 6=Sat) for a UTC instant in a timezone.
 * Uses noon (12:00 UTC) of the iterated day to avoid DST-at-midnight ambiguity.
 */
function getDow(timezone: string, date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]
    .indexOf(name);
}

/**
 * Format a UTC date in a timezone as a human-readable label.
 * e.g. "Mon, Jan 6 · 6:00 PM"
 */
function formatLocal(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Return UTC intervals for a slot within a week window.
 * Iterates day-by-day through the window and picks dates whose local
 * day-of-week matches the slot.
 */
function getUtcRanges(
  slot: AvailabilitySlot,
  timezone: string,
  windowOpens: Date,
  windowCloses: Date
): TimeRange[] {
  const [startH, endH] = BLOCK_HOURS[slot.block];
  const ranges: TimeRange[] = [];

  // Start at the beginning of the window's UTC day
  const cursor = new Date(windowOpens);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(windowCloses);

  while (cursor < end) {
    // Check DOW at noon on this UTC day (avoids DST-at-midnight edge cases)
    const noon = new Date(cursor.getTime() + 12 * 3_600_000);
    if (getDow(timezone, noon) === slot.dow) {
      // Get the UTC offset at noon on this day
      const offsetMs = getOffsetMs(timezone, noon);
      // local midnight UTC: local 00:00 = UTC 00:00 − offsetMs
      const localMidnightUtc = cursor.getTime() - offsetMs;

      const slotStart = new Date(localMidnightUtc + startH * 3_600_000);
      const slotEnd   = new Date(localMidnightUtc + endH   * 3_600_000);

      const clampedStart = new Date(Math.max(slotStart.getTime(), windowOpens.getTime()));
      const clampedEnd   = new Date(Math.min(slotEnd.getTime(),   windowCloses.getTime()));

      if (clampedStart < clampedEnd) {
        ranges.push({ startUtc: clampedStart, endUtc: clampedEnd });
      }
    }
    // Advance one UTC day
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ranges;
}

/**
 * Intersect two sorted lists of non-overlapping TimeRanges.
 */
function intersectRanges(as: TimeRange[], bs: TimeRange[]): TimeRange[] {
  const result: TimeRange[] = [];
  let ai = 0;
  let bi = 0;
  while (ai < as.length && bi < bs.length) {
    const a = as[ai]!;
    const b = bs[bi]!;
    const start = Math.max(a.startUtc.getTime(), b.startUtc.getTime());
    const end   = Math.min(a.endUtc.getTime(),   b.endUtc.getTime());
    if (start < end) {
      result.push({ startUtc: new Date(start), endUtc: new Date(end) });
    }
    if (a.endUtc.getTime() <= b.endUtc.getTime()) ai++;
    else bi++;
  }
  return result;
}

/**
 * Compute overlapping availability for two GMs over a game's weekly window.
 *
 * Returns every UTC interval during the window where both GMs are available,
 * plus the same interval formatted in each GM's own local timezone.
 */
export function computeOverlap(
  gm1: GmAvailabilityInput,
  gm2: GmAvailabilityInput,
  windowOpensAt: Date,
  windowClosesAt: Date
): OverlapResult {
  const sorted = (r: TimeRange[]) =>
    r.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());

  const ranges1 = sorted(
    gm1.slots.flatMap((s) => getUtcRanges(s, gm1.timezone, windowOpensAt, windowClosesAt))
  );
  const ranges2 = sorted(
    gm2.slots.flatMap((s) => getUtcRanges(s, gm2.timezone, windowOpensAt, windowClosesAt))
  );

  const overlapping = intersectRanges(ranges1, ranges2);

  const overlaps: OverlapWindow[] = overlapping.map((r) => ({
    startUtc: r.startUtc,
    endUtc:   r.endUtc,
    gm1Local: {
      label:    `${formatLocal(r.startUtc, gm1.timezone)} – ${formatLocal(r.endUtc, gm1.timezone)}`,
      timezone: gm1.timezone,
    },
    gm2Local: {
      label:    `${formatLocal(r.startUtc, gm2.timezone)} – ${formatLocal(r.endUtc, gm2.timezone)}`,
      timezone: gm2.timezone,
    },
  }));

  return { hasOverlap: overlaps.length > 0, overlaps };
}
