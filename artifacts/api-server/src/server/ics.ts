/**
 * Minimal RFC 5545 iCalendar (.ics) generation — just enough for a read-only
 * feed of scheduled games. No recurrence, no timezone VTIMEZONE blocks (all
 * DTSTART/DTEND are emitted in UTC, which every calendar client understands
 * without needing the source timezone database bundled in).
 */
export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const now = icsDate(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Front Office//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}@frontoffice`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(ev.start)}`,
      `DTEND:${icsDate(ev.end)}`,
      `SUMMARY:${escapeText(ev.summary)}`,
      `STATUS:${ev.status}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
