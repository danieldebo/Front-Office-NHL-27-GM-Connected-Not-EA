import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Game } from '@workspace/api-client-react';
import { SeasonGamesList } from './Schedule';

const game = {
  id: 'game-1',
  status: 'scheduled',
  away: {
    team_season_id: 'away-team',
    franchise_id: 'away-franchise',
    club_abbrev: 'AWY',
    gm_display_name: 'Away Coach',
    gm_platform: 'xbox',
    gm_primary_identity: 'playstation',
    gm_gamertag: 'AwayPSN',
  },
  home: {
    team_season_id: 'home-team',
    franchise_id: 'home-franchise',
    club_abbrev: 'HME',
    gm_display_name: 'Home Coach',
    gm_primary_identity: 'xbox',
    gm_gamertag: 'HomeXbox',
  },
} as Game;

describe('SeasonGamesList', () => {
  afterEach(cleanup);

  it('shows each side with canonical GM identity metadata', () => {
    render(<SeasonGamesList games={[game]} isLoading={false} />);

    const matchup = screen.getByTestId('schedule-game-game-1');
    expect(matchup.textContent).toContain('AWY');
    expect(matchup.textContent).toContain('Away Coach · PSN · AwayPSN');
    expect(matchup.textContent).toContain('HME');
    expect(matchup.textContent).toContain('Home Coach · Xbox · HomeXbox');
  });

  it('renders safely without a GM identity', () => {
    const noIdentity = {
      ...game,
      id: 'game-2',
      home: { ...game.home, gm_display_name: null, gm_primary_identity: null, gm_gamertag: null },
    };
    render(<SeasonGamesList games={[noIdentity]} isLoading={false} />);

    expect(screen.getByTestId('schedule-game-game-2').textContent).toContain('HME');
  });
});