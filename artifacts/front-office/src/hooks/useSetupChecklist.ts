/**
 * Derives the 6-step "new commissioner" setup checklist entirely from data
 * that already exists — no separate "onboarding state" table. Shared by the
 * Manage checklist card and the Hub's "setup incomplete" slab copy so the
 * two surfaces can never disagree about how many steps are left.
 */
import {
  useGetLeagueSettings,
  useListSeats,
  useListSeasons,
  useListRulebookRevisions,
  useGetCommissionerInvite,
  useListWeeks,
  useGetLeagueListing,
} from '@workspace/api-client-react';

export type ChecklistStepKey = 'settings' | 'seats' | 'rulebook' | 'invite' | 'schedule' | 'discovery';

export interface ChecklistStep {
  key: ChecklistStepKey;
  title: string;
  why: string;
  done: boolean;
  blockedReason: string | null;
  href: string;
}

export interface SetupChecklist {
  isLoading: boolean;
  steps: ChecklistStep[];
  doneCount: number;
  total: number;
  complete: boolean;
}

export function useSetupChecklist(leagueId: string): SetupChecklist {
  const { data: settingsResponse, isLoading: settingsLoading } = useGetLeagueSettings(leagueId, {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const hasSettings = Boolean(settingsResponse && 'id' in settingsResponse);

  const { data: seasonsData, isLoading: seasonsLoading } = useListSeasons(leagueId, {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const seasons = seasonsData?.data ?? [];
  const activeSeason = seasons.find((s: { is_active?: boolean }) => s.is_active) ?? null;

  const { data: seatsResponse, isLoading: seatsLoading } = useListSeats(leagueId, {
    query: { enabled: Boolean(activeSeason) } as any,
  });
  const seats = seatsResponse?.data ?? [];
  const teamCount = hasSettings && settingsResponse && 'team_count' in settingsResponse ? settingsResponse.team_count : null;

  const { data: rulebookRevisions, isLoading: rulebookLoading } = useListRulebookRevisions(leagueId, {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const hasRulebook = ((rulebookRevisions as any)?.data ?? []).length > 0;

  const { data: inviteEnvelope, isLoading: inviteLoading } = useGetCommissionerInvite(leagueId, {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const invite = inviteEnvelope?.invite ?? null;
  const inviteReady = Boolean(invite && (invite.max_uses != null || invite.expires_at != null || invite.uses > 0));

  const { data: weeksData, isLoading: weeksLoading } = useListWeeks(activeSeason?.id ?? '', {
    query: { enabled: Boolean(activeSeason?.id) } as any,
  });
  const hasSchedule = ((weeksData as any)?.data ?? []).length > 0;

  const { data: listing, isLoading: listingLoading } = useGetLeagueListing(leagueId, {
    query: { enabled: Boolean(leagueId) } as any,
  });
  const isListed = Boolean(listing?.is_listed);

  const isLoading = settingsLoading || seasonsLoading || seatsLoading || rulebookLoading || inviteLoading || weeksLoading || listingLoading;

  const noSeasonReason = 'Create a season first';

  const steps: ChecklistStep[] = [
    {
      key: 'settings',
      title: 'League settings',
      why: 'Sets rosters, cap, schedule format and playoff rules.',
      done: hasSettings,
      blockedReason: null,
      href: `/leagues/${leagueId}/manage?tab=settings`,
    },
    {
      key: 'seats',
      title: 'Franchise seats',
      why: 'Assign or open the teams your GMs will claim.',
      done: Boolean(activeSeason) && teamCount != null && seats.length === teamCount,
      blockedReason: activeSeason ? null : noSeasonReason,
      href: activeSeason ? `/leagues/${leagueId}/manage?tab=seats` : `/leagues/${leagueId}/season/new`,
    },
    {
      key: 'rulebook',
      title: 'Rulebook',
      why: 'The house rules GMs agree to when they join.',
      done: hasRulebook,
      blockedReason: null,
      href: `/leagues/${leagueId}/manage?tab=rulebook`,
    },
    {
      key: 'invite',
      title: 'Invite link',
      why: 'How GMs actually get in.',
      done: inviteReady,
      blockedReason: null,
      href: `/leagues/${leagueId}/manage?tab=links`,
    },
    {
      key: 'schedule',
      title: 'Schedule',
      why: 'Generate and publish the season slate.',
      done: hasSchedule,
      blockedReason: !activeSeason ? noSeasonReason : !hasSettings ? 'Needs league settings first' : null,
      href: activeSeason ? `/leagues/${leagueId}/manage?tab=schedule` : `/leagues/${leagueId}/season/new`,
    },
    {
      key: 'discovery',
      title: 'Open for signups',
      why: 'List on Open Leagues so GMs can find you.',
      done: isListed,
      blockedReason: null,
      href: `/leagues/${leagueId}/manage?tab=discovery`,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;

  return { isLoading, steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}
