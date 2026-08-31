import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SignupDrawer from './SignupDrawer';

describe('SignupDrawer division selection', () => {
  afterEach(cleanup);

  it('exposes ranked divisions as a native radio group', () => {
    render(
      <SignupDrawer
        league={{ league_id: 'league-1', name: 'Test League', seats_open: 1, platform: null }}
        mode="signup"
        onClose={() => undefined}
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Your ranked division' });
    const gold = screen.getByRole('radio', { name: 'Gold' }) as HTMLInputElement;
    expect(group).toContain(gold);
    expect(gold.checked).toBe(false);

    expect(gold.tagName).toBe('INPUT');
    fireEvent.click(gold);
    expect(gold.checked).toBe(true);
  });

  it('lets applicants choose more than one open franchise seat', () => {
    render(
      <SignupDrawer
        league={{
          league_id: 'league-1',
          name: 'Test League',
          seats_open: 2,
          platform: null,
          open_seat_options: [
            {
              team_season_id: 'seat-1',
              franchise_id: 'franchise-1',
              franchise_name: 'Toronto',
              club_name: 'Maple Leafs',
              club_abbrev: 'TOR',
            },
            {
              team_season_id: 'seat-2',
              franchise_id: 'franchise-2',
              franchise_name: 'Vancouver',
              club_name: 'Canucks',
              club_abbrev: 'VAN',
            },
          ],
        }}
        mode="waitlist"
        onClose={() => undefined}
      />,
    );

    const toronto = screen.getByRole('checkbox', { name: /Toronto/ }) as HTMLInputElement;
    const vancouver = screen.getByRole('checkbox', { name: /Vancouver/ }) as HTMLInputElement;
    fireEvent.click(toronto);
    fireEvent.click(vancouver);

    expect(toronto.checked).toBe(true);
    expect(vancouver.checked).toBe(true);
  });
});