import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssignedGm } from '@workspace/api-client-react';
import { SeatGmLabel } from './ManageLeague';
import { DEFAULT_PROFILE_ICON } from '@/components/profileIcons';

const gm: AssignedGm = {
  assignment_id: 'assignment-1',
  user_id: 'user-1',
  gm_display_name: 'Commissioner Coach',
  gm_platform: 'xbox',
  gm_primary_identity: 'playstation',
  gm_gamertag: 'CoachPSN',
};

describe('SeatGmLabel', () => {
  afterEach(cleanup);

  it('shows the assigned GM name and canonical primary identity as pills', () => {
    render(<SeatGmLabel gm={gm} seatId="seat-1" />);
    const card = screen.getByTestId('text-seat-gm-seat-1');
    expect(within(card).getByText('Commissioner Coach')).toBeTruthy();
    expect(within(card).getByText('PSN · CoachPSN')).toBeTruthy();
  });

  it('keeps an assigned GM readable without identity fields, falling back to the default icon in the avatar', () => {
    render(<SeatGmLabel gm={{ ...gm, gm_primary_identity: null, gm_platform: null, gm_gamertag: null }} seatId="seat-2" />);
    const card = screen.getByTestId('text-seat-gm-seat-2');
    expect(within(card).getByText('Commissioner Coach')).toBeTruthy();
    expect((card.querySelector('img') as HTMLImageElement).src).toBe(DEFAULT_PROFILE_ICON);
  });

  it('falls back to "Unknown GM" instead of a raw user id when display_name is missing', () => {
    render(<SeatGmLabel gm={{ ...gm, gm_display_name: null }} seatId="seat-3" />);
    const card = screen.getByTestId('text-seat-gm-seat-3');
    expect(within(card).getByText('Unknown GM')).toBeTruthy();
    expect(card.textContent).not.toContain('user-1');
  });

  it('renders an avatar image when profile_image_url is set', () => {
    render(<SeatGmLabel gm={{ ...gm, profile_image_url: 'https://example.test/avatar.png' }} seatId="seat-4" />);
    const img = screen.getByTestId('text-seat-gm-seat-4').querySelector('img');
    expect(img?.src).toBe('https://example.test/avatar.png');
  });

  it('shows first NHL game and league/site records when present, omitting a zeroed-out record', () => {
    render(
      <SeatGmLabel
        gm={{
          ...gm,
          first_nhl_game: 'NHL 94',
          league_record: { w: 12, l: 8, otl: 2 },
          site_record: { w: 0, l: 0, otl: 0 },
        }}
        seatId="seat-5"
      />,
    );
    const card = screen.getByTestId('text-seat-gm-seat-5');
    expect(within(card).getByText('NHL 94')).toBeTruthy();
    expect(within(card).getByText('12-8-2')).toBeTruthy();
    expect(within(card).queryByText('Site')).toBeNull();
  });

  it('omits the facts list entirely when there is nothing to show', () => {
    render(<SeatGmLabel gm={{ ...gm, first_nhl_game: null }} seatId="seat-6" />);
    const card = screen.getByTestId('text-seat-gm-seat-6');
    expect(within(card).queryByText('First game')).toBeNull();
    expect(within(card).queryByText('League')).toBeNull();
  });
});
