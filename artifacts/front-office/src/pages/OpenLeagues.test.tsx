import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenLeagues from './OpenLeagues';

const { authState, navigate } = vi.hoisted(() => ({
  authState: { isSignedIn: false, isLoaded: true },
  navigate: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => authState,
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/leagues/open', navigate],
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@workspace/api-client-react', () => ({
  useListNotifications: () => ({ data: { data: [], unread_count: 0 }, isLoading: false }),
  getListNotificationsQueryKey: () => ['/api/notifications'],
  resolvePublicCode: vi.fn(),
}));

const DRAFT_KEY = 'fo_signup_draft';

function makeLeague(overrides: Record<string, unknown> = {}) {
  return {
    league_id: 'league-1',
    slug: 'rust-belt',
    name: 'Rust Belt Hockey',
    logo_url: null,
    blurb: 'A steady, competitive league.',
    platform: 'psn',
    competitiveness: 'competitive',
    suggested_division: 'gold',
    accepting_signups: true,
    accepting_waitlist: true,
    active_season_id: 'season-1',
    max_seats: 12,
    seats_filled: 10,
    seats_open: 2,
    waitlist_length: 1,
    games_confirmed: 4,
    active_gms: 10,
    open_seat_options: [
      {
        team_season_id: 'seat-1',
        franchise_id: 'franchise-1',
        franchise_name: 'Toronto',
        club_name: 'Maple Leafs',
        club_abbrev: 'TOR',
      },
    ],
    ...overrides,
  };
}

function mockOpenLeagues(league: ReturnType<typeof makeLeague>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({ data: [league] }),
    }),
  );
}

describe('/leagues/open sign-up draft recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    authState.isSignedIn = false;
    authState.isLoaded = true;
    navigate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('saves the selected league draft and return path before sending an unauthenticated visitor to login', async () => {
    const league = makeLeague();
    mockOpenLeagues(league);

    render(<OpenLeagues />);

    fireEvent.click(await screen.findByRole('button', { name: 'Log in to sign up' }));

    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '')).toEqual({
      leagueId: league.league_id,
      mode: 'signup',
      league,
      formState: {
        countryCode: '',
        location: '',
        division: '',
        message: '',
        teamSeasonIds: [],
      },
      savedAt: expect.any(Number),
    });
    expect(sessionStorage.getItem('fo_return_path')).toBe('/leagues/open');
    expect(navigate).toHaveBeenCalledWith('/sign-in?redirect_url=/leagues/open');
  });

  it('restores the saved form into the fresh matching league after login', async () => {
    const staleLeague = makeLeague({ name: 'Old Rust Belt Name', seats_open: 3 });
    const freshLeague = makeLeague({ name: 'Rust Belt Hockey — Season 2', seats_open: 1 });
    const formState = {
      countryCode: 'CA',
      location: 'Toronto, ON',
      division: 'Diamond',
      message: 'Ready for a competitive season.',
      teamSeasonIds: ['seat-1'],
    };

    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        leagueId: staleLeague.league_id,
        mode: 'signup',
        league: staleLeague,
        formState,
        savedAt: Date.now(),
      }),
    );
    authState.isSignedIn = true;
    mockOpenLeagues(freshLeague);

    render(<OpenLeagues />);

    expect(await screen.findByText(`Sign up — ${freshLeague.name}`)).toBeTruthy();
    expect(screen.getByText('Eligibility uses your saved profile')).toBeTruthy();
    expect((screen.getByLabelText(/Country/) as HTMLSelectElement).value).toBe(formState.countryCode);
    expect((screen.getByLabelText(/Location/) as HTMLInputElement).value).toBe(formState.location);
    expect((screen.getByLabelText(/Message to the commissioner/) as HTMLInputElement).value).toBe(formState.message);
    expect((screen.getByRole('checkbox', { name: /Toronto/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByText(formState.division) as HTMLElement).className).toContain('sel');
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('clears a corrupt saved draft without crashing or opening a drawer', async () => {
    sessionStorage.setItem(DRAFT_KEY, '{not valid json');
    authState.isSignedIn = true;
    const league = makeLeague();
    mockOpenLeagues(league);

    render(<OpenLeagues />);

    expect(await screen.findByRole('button', { name: 'Sign up' })).toBeTruthy();
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(screen.queryByText(`Sign up — ${league.name}`)).toBeNull();
  });

  it('clears a draft older than 30 minutes without opening a drawer', async () => {
    const league = makeLeague();
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        leagueId: league.league_id,
        mode: 'signup',
        league,
        formState: {
          countryCode: '',
          location: '',
          division: '',
          message: '',
          teamSeasonIds: [],
        },
        savedAt: Date.now() - (30 * 60 * 1000 + 1),
      }),
    );
    authState.isSignedIn = true;
    mockOpenLeagues(league);

    render(<OpenLeagues />);

    expect(await screen.findByRole('button', { name: 'Sign up' })).toBeTruthy();
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(screen.queryByText(`Sign up — ${league.name}`)).toBeNull();
  });
});