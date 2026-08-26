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

describe('Profile', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads the authenticated profile and saves edited fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => profile,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...profile, display_name: 'Coach Updated' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<Profile />);

    const displayName = await screen.findByTestId('input-display-name') as HTMLInputElement;
    expect(displayName.value).toBe('Coach One');
    expect((screen.getByTestId('input-timezone') as HTMLInputElement).value).toBe('America/New_York');
    expect((screen.getByTestId('checkbox-system-xbox') as HTMLInputElement).checked).toBe(true);

    fireEvent.change(displayName, { target: { value: 'Coach Updated' } });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/users/me',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      display_name: 'Coach Updated',
      timezone: 'America/New_York',
      xbox_gamertag: 'CoachXbox',
      psn_online_id: null,
      systems_played: ['xbox'],
      primary_identity: 'xbox',
    });
    expect((await screen.findByTestId('status-profile-saved')).textContent).toBe('Profile saved.');
  });

  it('requires a valid IANA time zone before sending a patch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => profile,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Profile />);

    const timezone = await screen.findByTestId('input-timezone');
    fireEvent.change(timezone, { target: { value: 'Eastern Time' } });
    fireEvent.click(screen.getByTestId('button-save-profile'));

    expect(await screen.findByText(/valid IANA time zone/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});