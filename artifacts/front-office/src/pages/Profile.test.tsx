import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Profile from './Profile';

vi.mock('@/components/Header', () => ({
  default: () => <header>Header</header>,
}));

const profile = {
  id: 'user-1',
  display_name: 'Coach One',
  timezone: 'America/New_York',
  xbox_gamertag: 'CoachXbox',
  psn_online_id: null,
  systems_played: ['xbox'],
  primary_identity: 'xbox',
};

/**
 * Profile now renders the Xbox verification panel alongside the profile
 * form, which fires its own /api/xbox/link fetch via react-query on mount.
 * Route every call by URL/method instead of a positional queue so the two
 * concurrent fetchers don't fight over a shared call-order assumption.
 */
function stubFetch(overrides: { onPatch?: (body: unknown) => unknown } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/xbox/link') {
      return { ok: true, json: async () => ({ linked: false }) };
    }
    if (url === '/api/users/me' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      return { ok: true, json: async () => (overrides.onPatch ? overrides.onPatch(body) : { ...profile, ...body }) };
    }
    if (url === '/api/users/me') {
      return { ok: true, json: async () => profile };
    }
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof stubFetch>, url: string) {
  return fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === url);
}

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Profile />
    </QueryClientProvider>,
  );
}

describe('Profile', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads the authenticated profile and saves edited fields', async () => {
    const fetchMock = stubFetch();

    renderProfile();

    const displayName = await screen.findByTestId('input-display-name') as HTMLInputElement;
    expect(displayName.value).toBe('Coach One');
    expect((screen.getByTestId('input-timezone') as HTMLInputElement).value).toBe('America/New_York');
    expect((screen.getByTestId('checkbox-system-xbox') as HTMLInputElement).checked).toBe(true);

    fireEvent.change(displayName, { target: { value: 'Coach Updated' } });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    await waitFor(() => expect(callsTo(fetchMock, '/api/users/me')).toHaveLength(2));
    const [, patchInit] = callsTo(fetchMock, '/api/users/me')[1]!;
    expect(patchInit).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(String(patchInit!.body))).toEqual({
      display_name: 'Coach Updated',
      timezone: 'America/New_York',
      xbox_gamertag: 'CoachXbox',
      psn_online_id: null,
      systems_played: ['xbox'],
      primary_identity: 'xbox',
      first_nhl_game: null,
      profile_image_url: null,
    });
    expect((await screen.findByTestId('status-profile-saved')).textContent).toBe('Profile saved.');
  });

  it('loads and saves first_nhl_game and profile_image_url', async () => {
    const fetchMock = stubFetch({
      onPatch: (body) => ({ ...profile, first_nhl_game: 'NHL 94', profile_image_url: 'https://example.test/me.png', ...(body as object) }),
    });
    renderProfile();

    const firstGame = await screen.findByTestId('input-first-nhl-game') as HTMLInputElement;
    expect(firstGame.value).toBe('');

    fireEvent.change(firstGame, { target: { value: 'NHL 94' } });
    fireEvent.change(screen.getByTestId('input-profile-image-url'), { target: { value: 'https://example.test/me.png' } });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    await waitFor(() => expect(callsTo(fetchMock, '/api/users/me')).toHaveLength(2));
    const [, patchInit] = callsTo(fetchMock, '/api/users/me')[1]!;
    expect(JSON.parse(String(patchInit!.body))).toMatchObject({
      first_nhl_game: 'NHL 94',
      profile_image_url: 'https://example.test/me.png',
    });
    expect((await screen.findByTestId('status-profile-saved')).textContent).toBe('Profile saved.');
  });

  it('rejects a profile image URL that is not http(s)', async () => {
    stubFetch();
    renderProfile();

    const imageUrl = await screen.findByTestId('input-profile-image-url');
    fireEvent.change(imageUrl, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    expect(await screen.findByText(/http\(s\) image URL/i)).toBeTruthy();
  });

  it('requires a valid IANA time zone before sending a patch', async () => {
    const fetchMock = stubFetch();
    renderProfile();

    const timezone = await screen.findByTestId('input-timezone');
    fireEvent.change(timezone, { target: { value: 'Eastern Time' } });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    expect(await screen.findByText(/valid IANA time zone/i)).toBeTruthy();
    expect(callsTo(fetchMock, '/api/users/me')).toHaveLength(1);
  });
});
