import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenLeagues from './OpenLeagues';

const { authState, navigate } = vi.hoisted(() => ({
  authState: { isAuthenticated: false, isLoading: false },
  navigate: vi.fn(),
}));

vi.mock('@workspace/replit-auth-web', () => ({
  useAuth: () => authState,
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/leagues/open', navigate],
}));

vi.mock('@workspace/api-client-react', () => ({
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
    authState.isAuthenticated = false;
    authState.isLoading = false;
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
        platform: league.platform,
        timezone: '',
        countryCode: '',
        location: '',
        division: '',
        message: '',
        preferredClub: '',
      },
      savedAt: expect.any(Number),
    });
    expect(sessionStorage.getItem('fo_return_path')).toBe('/leagues/open');
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('restores the saved form into the fresh matching league after login', async () => {
    const staleLeague = makeLeague({ name: 'Old Rust Belt Name', seats_open: 3 });
    const freshLeague = makeLeague({ name: 'Rust Belt Hockey — Season 2', seats_open: 1 });
    const formState = {
      platform: 'xbox',
      timezone: 'America/Chicago',
      countryCode: 'CA',
      location: 'Toronto, ON',
      division: 'Diamond',
      message: 'Ready for a competitive season.',
      preferredClub: 'Toronto Maple Leafs',
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
    authState.isAuthenticated = true;
    mockOpenLeagues(freshLeague);

    render(<OpenLeagues />);

    expect(await screen.findByText(`Sign up — ${freshLeague.name}`)).toBeTruthy();
    expect((screen.getByLabelText('Platform') as HTMLSelectElement).value).toBe(formState.platform);
    expect((screen.getByLabelText('Time zone') as HTMLSelectElement).value).toBe(formState.timezone);
    expect((screen.getByLabelText(/Country/) as HTMLSelectElement).value).toBe(formState.countryCode);
    expect((screen.getByLabelText(/Location/) as HTMLInputElement).value).toBe(formState.location);
    expect((screen.getByLabelText(/Message to the commissioner/) as HTMLInputElement).value).toBe(formState.message);
    expect((screen.getByLabelText(/Preferred club/) as HTMLInputElement).value).toBe(formState.preferredClub);
    expect((screen.getByText(formState.division) as HTMLElement).className).toContain('sel');
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('clears a corrupt saved draft without crashing or opening a drawer', async () => {
    sessionStorage.setItem(DRAFT_KEY, '{not valid json');
    authState.isAuthenticated = true;
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
          platform: 'xbox',
          timezone: '',
          countryCode: '',
          location: '',
          division: '',
          message: '',
          preferredClub: '',
        },
        savedAt: Date.now() - (30 * 60 * 1000 + 1),
      }),
    );
    authState.isAuthenticated = true;
    mockOpenLeagues(league);

    render(<OpenLeagues />);

    expect(await screen.findByRole('button', { name: 'Sign up' })).toBeTruthy();
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(screen.queryByText(`Sign up — ${league.name}`)).toBeNull();
  });
});