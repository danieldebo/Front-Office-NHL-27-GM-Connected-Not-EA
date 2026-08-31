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
  xbox_identity_verified_at: null,
  playstation_identity_verified_at: null,
};

describe('Profile', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('creates and submits an identity verification challenge for commissioner review', async () => {
    const challenge = {
      challenge_id: 'challenge-1',
      platform: 'xbox',
      gamertag: 'CoachXbox',
      code: 'FO-ABC123',
      expires_at: '2026-08-30T12:15:00.000Z',
      profile_url: 'https://account.xbox.com/en-us/profile?gamertag=CoachXbox',
    };
    const submission = {
      challenge_id: 'challenge-1',
      platform: 'xbox',
      submitted_at: '2026-08-30T12:05:00.000Z',
      expires_at: challenge.expires_at,
      review_path: '/identity-verifications/review/challenge-1',
      status: 'pending_commissioner_review',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => profile })
      .mockResolvedValueOnce({ ok: true, json: async () => challenge })
      .mockResolvedValueOnce({ ok: true, json: async () => submission });
    vi.stubGlobal('fetch', fetchMock);
    render(<Profile />);

    fireEvent.click(await screen.findByTestId('button-challenge-xbox'));
    expect((await screen.findByTestId('challenge-code-xbox')).textContent).toBe('FO-ABC123');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/users/me/identity-verifications/xbox/challenge');

    fireEvent.click(screen.getByTestId('button-complete-xbox'));
    await waitFor(() => expect(screen.getByTestId('review-path-xbox').textContent).toBe(submission.review_path));
    expect(fetchMock.mock.calls[2][0]).toBe('/api/users/me/identity-verifications/xbox/complete');
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