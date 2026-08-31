// Zod validation schemas — for server-side request/response validation.
export * from "./generated/api";

// TypeScript types — generated interfaces. Exported individually (not via
// `export * from "./generated/types"`) to avoid TS2308 ambiguity on names
// that also exist as Zod consts in generated/api (e.g. ListGamesParams).
export type { AnnouncementInput } from "./generated/types/announcementInput";
export type { AnnouncementReceipt } from "./generated/types/announcementReceipt";
export type { ApplicantActionResult } from "./generated/types/applicantActionResult";
export type { ApplicantActionResultOutcome } from "./generated/types/applicantActionResultOutcome";
export type { ApplicantSeatOption } from "./generated/types/applicantSeatOption";
export type { ApplicantSeatPreference } from "./generated/types/applicantSeatPreference";
export type { ApplicantSeatPreferenceInput } from "./generated/types/applicantSeatPreferenceInput";
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
export type { CreateTransactionInput } from "./generated/types/createTransactionInput";
export type { CreateTransactionInputEntrySource } from "./generated/types/createTransactionInputEntrySource";
export type { CreateTransactionInputType } from "./generated/types/createTransactionInputType";
export type { DeclineApplicantInput } from "./generated/types/declineApplicantInput";
export type { DiscordEventFilter } from "./generated/types/discordEventFilter";
export type { DiscordWebhook } from "./generated/types/discordWebhook";
export type { DiscordWebhookInput } from "./generated/types/discordWebhookInput";
export type { DiscordWebhookList } from "./generated/types/discordWebhookList";
export type { DiscordWebhookUpdate } from "./generated/types/discordWebhookUpdate";
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
export type { HubApplicantActivity } from "./generated/types/hubApplicantActivity";
export type { HubApplicantActivitySource } from "./generated/types/hubApplicantActivitySource";
export type { IdempotencyKeyParameter } from "./generated/types/idempotencyKeyParameter";
export type { IdentityVerificationApproval } from "./generated/types/identityVerificationApproval";
export type { IdentityVerificationApprovalStatus } from "./generated/types/identityVerificationApprovalStatus";
export type { IdentityVerificationChallenge } from "./generated/types/identityVerificationChallenge";
export type { IdentityVerificationReview } from "./generated/types/identityVerificationReview";
export type { IdentityVerificationReviewStatus } from "./generated/types/identityVerificationReviewStatus";
export type { IdentityVerificationSubmission } from "./generated/types/identityVerificationSubmission";
export type { IdentityVerificationSubmissionStatus } from "./generated/types/identityVerificationSubmissionStatus";
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
export type { LeagueSettingsInputAppliedTemplateId } from "./generated/types/leagueSettingsInputAppliedTemplateId";
export type { LeagueSettingsInputPlatform } from "./generated/types/leagueSettingsInputPlatform";
export type { LeagueSettingsInputPlayoffFormat } from "./generated/types/leagueSettingsInputPlayoffFormat";
export type { LeagueSettingsInputRosterSource } from "./generated/types/leagueSettingsInputRosterSource";
export type { LeagueSettingsInputScheduleFormat } from "./generated/types/leagueSettingsInputScheduleFormat";
export type { LeagueSettingsInputScheduleSettings } from "./generated/types/leagueSettingsInputScheduleSettings";
export type { LeagueSettingsInputSliderPresets } from "./generated/types/leagueSettingsInputSliderPresets";
export type { LeagueSettingsTemplate } from "./generated/types/leagueSettingsTemplate";
export type { LeagueSettingsTemplateId } from "./generated/types/leagueSettingsTemplateId";
export type { LeagueSettingsTemplateList } from "./generated/types/leagueSettingsTemplateList";
export type { LeagueSettingsTemplateValues } from "./generated/types/leagueSettingsTemplateValues";
export type { LeagueSettingsTemplateValuesPlatform } from "./generated/types/leagueSettingsTemplateValuesPlatform";
export type { LeagueSettingsTemplateValuesPlayoffFormat } from "./generated/types/leagueSettingsTemplateValuesPlayoffFormat";
export type { LeagueSettingsTemplateValuesRosterSource } from "./generated/types/leagueSettingsTemplateValuesRosterSource";
export type { LeagueSettingsTemplateValuesScheduleFormat } from "./generated/types/leagueSettingsTemplateValuesScheduleFormat";
export type { LeagueSettingsTemplateValuesScheduleSettings } from "./generated/types/leagueSettingsTemplateValuesScheduleSettings";
export type { LeagueSettingsTemplateValuesSliderPresets } from "./generated/types/leagueSettingsTemplateValuesSliderPresets";
export type { LeagueSettingsVersion } from "./generated/types/leagueSettingsVersion";
// LeagueSignup intentionally excluded — collides with Zod const of the same name in generated/api.ts
// LeagueSignupInput intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { LeagueSignupInputStatedDivision } from "./generated/types/leagueSignupInputStatedDivision";
export type { LeagueVisibility } from "./generated/types/leagueVisibility";
// ListDqFindingsParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListDqFindingsSeverity } from "./generated/types/listDqFindingsSeverity";
export type { ListGames200 } from "./generated/types/listGames200";
// ListGamesParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListInvites200 } from "./generated/types/listInvites200";
export type { ListJoinRequests200 } from "./generated/types/listJoinRequests200";
// ListJoinRequestsParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListJoinRequestsStatus } from "./generated/types/listJoinRequestsStatus";
export type { ListLeagueSignups200 } from "./generated/types/listLeagueSignups200";
export type { ListLeagueSignupsParams } from "./generated/types/listLeagueSignupsParams";
export type { ListLeagueWaitlist200 } from "./generated/types/listLeagueWaitlist200";
export type { ListLeagueWaitlistParams } from "./generated/types/listLeagueWaitlistParams";
export type { ListNotificationsParams } from "./generated/types/listNotificationsParams";
export type { ListOpenLeagues200 } from "./generated/types/listOpenLeagues200";
export type { ListOpenLeaguesCompetitiveness } from "./generated/types/listOpenLeaguesCompetitiveness";
// ListOpenLeaguesParams intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { ListOpenLeaguesPlatform } from "./generated/types/listOpenLeaguesPlatform";
export type { ListOpenLeaguesSeatsOpen } from "./generated/types/listOpenLeaguesSeatsOpen";
export type { ListRulebookRevisions200 } from "./generated/types/listRulebookRevisions200";
export type { ListSeasons200 } from "./generated/types/listSeasons200";
export type { ListSeats200 } from "./generated/types/listSeats200";
export type { NoLeagueSettings } from "./generated/types/noLeagueSettings";
export type { Notification } from "./generated/types/notification";
export type { NotificationData } from "./generated/types/notificationData";
export type { NotificationList } from "./generated/types/notificationList";
export type { NotificationPreference } from "./generated/types/notificationPreference";
export type { NotificationPreferenceInput } from "./generated/types/notificationPreferenceInput";
export type { NotificationPreferenceList } from "./generated/types/notificationPreferenceList";
// OpenLeague intentionally excluded — collides with Zod const of the same name in generated/api.ts
export type { OpenSeatDetail } from "./generated/types/openSeatDetail";
export type { OpenSeatDetailState } from "./generated/types/openSeatDetailState";
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
export type { Transaction } from "./generated/types/transaction";
export type { TransactionAsset } from "./generated/types/transactionAsset";
export type { TransactionAssetKind } from "./generated/types/transactionAssetKind";
export type { TransactionList } from "./generated/types/transactionList";
export type { TransactionProvenance } from "./generated/types/transactionProvenance";
export type { TransactionRationaleInput } from "./generated/types/transactionRationaleInput";
export type { TransactionStatus } from "./generated/types/transactionStatus";
export type { TransactionType } from "./generated/types/transactionType";
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
