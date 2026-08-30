import { randomBytes, randomInt } from "crypto";

/**
 * Commissioner invite tokens used to read like `f3a9c1e2-...` (crypto.randomUUID()).
 * Still opaque and unguessable — just memorable enough that a commissioner can say
 * it out loud in a Discord call — a hockey/gamer word pair plus a short suffix
 * for collision resistance, since a word pair alone isn't unique enough for a
 * DB-enforced UNIQUE column.
 */
const HOCKEY_WORDS = [
  "slapshot", "blueline", "zamboni", "faceoff", "hattrick", "powerplay",
  "boarding", "deke", "snipe", "biscuit", "crease", "icing", "onetimer",
  "breakaway", "rebound", "highstick", "gretzky", "orr", "roughing",
  "penaltybox", "shutout", "wristshot", "backcheck", "forecheck", "sindin",
  "goalline", "netminder", "puckluck", "chirp", "celly", "flow",
];

const GAMER_WORDS = [
  "clutch", "respawn", "loadout", "gg", "noscope", "grind", "meta",
  "speedrun", "combo", "frag", "boss", "loot", "spawn", "glitch",
  "hitbox", "cooldown", "overtime", "sweat", "carry", "smurf",
  "lagswitch", "buff", "nerf", "clip", "pixel", "arcade", "pwned",
  "questline", "sidequest", "checkpoint",
];

function pick(words: string[]): string {
  return words[randomInt(words.length)]!;
}

/** e.g. "slapshot-clutch-7f3a" — unique-enough for a UNIQUE token column, and
 * something a commissioner can actually read aloud. */
export function generateInviteToken(): string {
  const suffix = randomBytes(2).toString("hex");
  return `${pick(HOCKEY_WORDS)}-${pick(GAMER_WORDS)}-${suffix}`;
}
