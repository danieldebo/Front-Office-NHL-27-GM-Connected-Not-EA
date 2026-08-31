import { describe, it, expect } from "vitest";
import { buildIcs } from "../ics";

describe("buildIcs", () => {
  it("produces a valid VCALENDAR wrapper with one VEVENT per game", () => {
    const ics = buildIcs("My League", [
      {
        uid: "game-1",
        start: new Date("2026-01-05T00:00:00Z"),
        end: new Date("2026-01-07T00:00:00Z"),
        summary: "Away Club @ Home Club",
        status: "TENTATIVE",
      },
    ]);

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:game-1@frontoffice");
    expect(ics).toContain("DTSTART:20260105T000000Z");
    expect(ics).toContain("SUMMARY:Away Club @ Home Club");
    expect(ics).toContain("STATUS:TENTATIVE");
    expect(ics).toContain("X-WR-CALNAME:My League");
  });

  it("escapes commas, semicolons, and backslashes in summary text", () => {
    const ics = buildIcs("Cal", [
      {
        uid: "game-2",
        start: new Date(),
        end: new Date(),
        summary: "Foo; Bar, Baz\\Qux",
        status: "CONFIRMED",
      },
    ]);
    expect(ics).toContain("SUMMARY:Foo\\; Bar\\, Baz\\\\Qux");
  });

  it("produces an empty-but-valid calendar with no events", () => {
    const ics = buildIcs("Empty", []);
    expect(ics).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Front Office//Calendar Feed//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Empty\r\nEND:VCALENDAR\r\n");
  });
});
