// Zod validation schemas — for server-side request/response validation.
export * from "./generated/api";

// TypeScript types — generated interfaces. Exported individually (not via
// `export * from "./generated/types"`) to avoid TS2308 ambiguity on names
// that also exist as Zod consts in generated/api (e.g. ListGamesParams).
export type { AuthUser } from "./generated/types/authUser";
export type { AuthUserEnvelope } from "./generated/types/authUserEnvelope";
export type { AuthorizationSessionHeaderParameter } from "./generated/types/authorizationSessionHeaderParameter";
export type { BeginBrowserLoginParams } from "./generated/types/beginBrowserLoginParams";
export type { ConfirmInput } from "./generated/types/confirmInput";
export type { ErrorEnvelope } from "./generated/types/errorEnvelope";
export type { Game } from "./generated/types/game";
export type { GameResult } from "./generated/types/gameResult";
export type { GameResultDataSource } from "./generated/types/gameResultDataSource";
export type { GameResultDecision } from "./generated/types/gameResultDecision";
export type { GameSide } from "./generated/types/gameSide";
export type { GameStatus } from "./generated/types/gameStatus";
export type { GetMyLeagues200 } from "./generated/types/getMyLeagues200";
export type { GetStandings200 } from "./generated/types/getStandings200";
export type { HandleBrowserLoginCallbackParams } from "./generated/types/handleBrowserLoginCallbackParams";
export type { HealthStatus } from "./generated/types/healthStatus";
export type { IdempotencyKeyParameter } from "./generated/types/idempotencyKeyParameter";
export type { IfMatchParameter } from "./generated/types/ifMatchParameter";
export type { League } from "./generated/types/league";
export type { LeagueHub } from "./generated/types/leagueHub";
export type { LeagueVisibility } from "./generated/types/leagueVisibility";
export type { ListGames200 } from "./generated/types/listGames200";
// ListGamesParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListSeasons200 } from "./generated/types/listSeasons200";
export type { LogoutBrowserSessionParams } from "./generated/types/logoutBrowserSessionParams";
export type { LogoutSuccess } from "./generated/types/logoutSuccess";
export type { MobileTokenExchangeInput } from "./generated/types/mobileTokenExchangeInput";
export type { MobileTokenExchangeSuccess } from "./generated/types/mobileTokenExchangeSuccess";
export type { Problem } from "./generated/types/problem";
export type { ProblemError } from "./generated/types/problemError";
export type { ResultInput } from "./generated/types/resultInput";
export type { ResultInputDecision } from "./generated/types/resultInputDecision";
export type { Season } from "./generated/types/season";
export type { StandingsRow } from "./generated/types/standingsRow";
