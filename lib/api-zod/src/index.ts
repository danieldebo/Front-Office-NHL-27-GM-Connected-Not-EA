// Zod validation schemas — for server-side request/response validation.
export * from "./generated/api";

// TypeScript types — generated interfaces. Exported individually (not via
// `export * from "./generated/types"`) to avoid TS2308 ambiguity on names
// that also exist as Zod consts in generated/api (e.g. ListGamesParams).
export type { ApplicantActionResult } from "./generated/types/applicantActionResult";
export type { ApplicantActionResultOutcome } from "./generated/types/applicantActionResultOutcome";
export type { AssignGmInput } from "./generated/types/assignGmInput";
export type { AssignGmInputRole } from "./generated/types/assignGmInputRole";
export type { AssignedGm } from "./generated/types/assignedGm";
// AvailabilitySlot intentionally excluded — collides with Zod const of the same name in generated/api.ts
// AvailabilitySlotBlock intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ClaimOutcome } from "./generated/types/claimOutcome";
export type { ClaimOutcomeOutcome } from "./generated/types/claimOutcomeOutcome";
export type { CommissionerInvite } from "./generated/types/commissionerInvite";
export type { CommissionerInviteEnvelope } from "./generated/types/commissionerInviteEnvelope";
export type { CommissionerInviteInput } from "./generated/types/commissionerInviteInput";
export type { CommissionerInvitePublic } from "./generated/types/commissionerInvitePublic";
export type { ConfirmInput } from "./generated/types/confirmInput";
export type { CreateInviteInput } from "./generated/types/createInviteInput";
export type { CreateLeagueInput } from "./generated/types/createLeagueInput";
export type { CreateLeagueInputVisibility } from "./generated/types/createLeagueInputVisibility";
export type { CreateSeasonInput } from "./generated/types/createSeasonInput";
export type { DeclineApplicantInput } from "./generated/types/declineApplicantInput";
export type { DqFinding } from "./generated/types/dqFinding";
export type { DqFindingSeverity } from "./generated/types/dqFindingSeverity";
export type { DqFindingsEnvelope } from "./generated/types/dqFindingsEnvelope";
export type { ErrorEnvelope } from "./generated/types/errorEnvelope";
// FeatureRequestInput intentionally excluded — collides with Zod const of the same name in generated/api.ts
// FeatureRequestReceipt intentionally excluded — collides with Zod const of the same name in generated/api.ts
// ForceResolveGameBody intentionally excluded — collides with Zod const of the same name in generated/api.ts
// ForceResolveGameBodyResolution intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { Game } from "./generated/types/game";
export type { GameResult } from "./generated/types/gameResult";
export type { GameResultDataSource } from "./generated/types/gameResultDataSource";
export type { GameResultDecision } from "./generated/types/gameResultDecision";
export type { GameSide } from "./generated/types/gameSide";
export type { GameStatus } from "./generated/types/gameStatus";
// GenerateScheduleBody intentionally excluded — collides with Zod const of the same name in generated/api.ts
// GenerateScheduleResult intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { GetMyLeagues200 } from "./generated/types/getMyLeagues200";
export type { GetStandings200 } from "./generated/types/getStandings200";
export type { HealthStatus } from "./generated/types/healthStatus";
export type { IdempotencyKeyParameter } from "./generated/types/idempotencyKeyParameter";
export type { IfMatchParameter } from "./generated/types/ifMatchParameter";
export type { InviteLink } from "./generated/types/inviteLink";
export type { JoinRequest } from "./generated/types/joinRequest";
export type { JoinRequestStatus } from "./generated/types/joinRequestStatus";
export type { League } from "./generated/types/league";
export type { LeagueApplicant } from "./generated/types/leagueApplicant";
export type { LeagueHub } from "./generated/types/leagueHub";
export type { LeagueListing } from "./generated/types/leagueListing";
export type { LeagueListingCompetitiveness } from "./generated/types/leagueListingCompetitiveness";
export type { LeagueListingPlatform } from "./generated/types/leagueListingPlatform";
export type { LeagueSettingsHistory } from "./generated/types/leagueSettingsHistory";
export type { LeagueSettingsInput } from "./generated/types/leagueSettingsInput";
export type { LeagueSettingsInputPlatform } from "./generated/types/leagueSettingsInputPlatform";
export type { LeagueSettingsInputPlayoffFormat } from "./generated/types/leagueSettingsInputPlayoffFormat";
export type { LeagueSettingsInputRosterSource } from "./generated/types/leagueSettingsInputRosterSource";
export type { LeagueSettingsInputScheduleFormat } from "./generated/types/leagueSettingsInputScheduleFormat";
export type { LeagueSettingsInputScheduleSettings } from "./generated/types/leagueSettingsInputScheduleSettings";
export type { LeagueSettingsInputSliderPresets } from "./generated/types/leagueSettingsInputSliderPresets";
export type { LeagueSettingsVersion } from "./generated/types/leagueSettingsVersion";
// LeagueSignup intentionally excluded — collides with Zod const of the same name in generated/api.ts
// LeagueSignupInput intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { LeagueSignupInputStatedDivision } from "./generated/types/leagueSignupInputStatedDivision";
export type { LeagueVisibility } from "./generated/types/leagueVisibility";
export type { ListDqFindingsParams } from "./generated/types/listDqFindingsParams";
export type { ListDqFindingsSeverity } from "./generated/types/listDqFindingsSeverity";
export type { ListGames200 } from "./generated/types/listGames200";
// ListGamesParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListInvites200 } from "./generated/types/listInvites200";
export type { ListJoinRequests200 } from "./generated/types/listJoinRequests200";
export type { ListJoinRequestsParams } from "./generated/types/listJoinRequestsParams";
export type { ListJoinRequestsStatus } from "./generated/types/listJoinRequestsStatus";
export type { ListLeagueSignups200 } from "./generated/types/listLeagueSignups200";
export type { ListLeagueWaitlist200 } from "./generated/types/listLeagueWaitlist200";
export type { ListOpenLeagues200 } from "./generated/types/listOpenLeagues200";
export type { ListOpenLeaguesCompetitiveness } from "./generated/types/listOpenLeaguesCompetitiveness";
// ListOpenLeaguesParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListOpenLeaguesPlatform } from "./generated/types/listOpenLeaguesPlatform";
export type { ListOpenLeaguesSeatsOpen } from "./generated/types/listOpenLeaguesSeatsOpen";
export type { ListRulebookRevisions200 } from "./generated/types/listRulebookRevisions200";
export type { ListSeasons200 } from "./generated/types/listSeasons200";
export type { ListSeats200 } from "./generated/types/listSeats200";
export type { ListUnassignedMembers200 } from "./generated/types/listUnassignedMembers200";
// OpenLeague intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { PlayerSystem } from "./generated/types/playerSystem";
// PostponeGameBody intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { Problem } from "./generated/types/problem";
export type { ProblemError } from "./generated/types/problemError";
export type { PublicCodeLookup } from "./generated/types/publicCodeLookup";
export type { PublicCodeResult } from "./generated/types/publicCodeResult";
export type { PublicLeagueEnvelope } from "./generated/types/publicLeagueEnvelope";
export type { PublicLeagueEnvelopeLeague } from "./generated/types/publicLeagueEnvelopeLeague";
export type { PublicLeagueEnvelopeListing } from "./generated/types/publicLeagueEnvelopeListing";
export type { PublicLeagueEnvelopeSeason } from "./generated/types/publicLeagueEnvelopeSeason";
export type { PublishRulebookInput } from "./generated/types/publishRulebookInput";
export type { ReorderWaitlistEntry200 } from "./generated/types/reorderWaitlistEntry200";
export type { ResultInput } from "./generated/types/resultInput";
export type { ResultInputDecision } from "./generated/types/resultInputDecision";
export type { RevokeGmParams } from "./generated/types/revokeGmParams";
export type { RulebookRevision } from "./generated/types/rulebookRevision";
export type { Season } from "./generated/types/season";
export type { Seat } from "./generated/types/seat";
export type { SeatSeatStatus } from "./generated/types/seatSeatStatus";
// SetAvailabilityBody intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { SetPublicCodeInput } from "./generated/types/setPublicCodeInput";
// ShiftWindowBody intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { StandingsRow } from "./generated/types/standingsRow";
export type { StandingsRowProvenance } from "./generated/types/standingsRowProvenance";
export type { UnassignedMember } from "./generated/types/unassignedMember";
export type { UnassignedMemberIdentity } from "./generated/types/unassignedMemberIdentity";
export type { UpdateLeagueInput } from "./generated/types/updateLeagueInput";
export type { UpdateLeagueInputVisibility } from "./generated/types/updateLeagueInputVisibility";
export type { UpdateLeagueListingInput } from "./generated/types/updateLeagueListingInput";
export type { UpdateLeagueListingInputCompetitiveness } from "./generated/types/updateLeagueListingInputCompetitiveness";
export type { UpdateLeagueListingInputPlatform } from "./generated/types/updateLeagueListingInputPlatform";
export type { UserProfile } from "./generated/types/userProfile";
export type { UserProfileUpdate } from "./generated/types/userProfileUpdate";
export type { WaitlistApplicant } from "./generated/types/waitlistApplicant";
export type { WaitlistApplicantStatus } from "./generated/types/waitlistApplicantStatus";
// WaitlistEntry intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { WaitlistEntryStatus } from "./generated/types/waitlistEntryStatus";
export type { WaitlistPositionInput } from "./generated/types/waitlistPositionInput";
// WeekListEnvelope intentionally excluded — collides with Zod const of the same name in generated/api.ts
// WeekStatus intentionally excluded — collides with Zod const of the same name in generated/api.ts
// WeekWindow intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { XboxLinkStatus } from "./generated/types/xboxLinkStatus";
