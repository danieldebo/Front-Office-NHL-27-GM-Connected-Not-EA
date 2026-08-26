import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AssignedGm } from '@workspace/api-client-react';
import { SeatGmLabel } from './ManageLeague';

const gm: AssignedGm = {
  assignment_id: 'assignment-1',
  user_id: 'user-1',
  display_name: 'Commissioner Coach',
  gm_platform: 'xbox',
  gm_primary_identity: 'playstation',
  gm_gamertag: 'CoachPSN',
};

describe('SeatGmLabel', () => {
  afterEach(cleanup);

  it('shows the assigned GM canonical primary identity', () => {
    render(<SeatGmLabel gm={gm} seatId="seat-1" />);
    expect(screen.getByTestId('text-seat-gm-seat-1').textContent)
      .toContain('GM: Commissioner Coach · PSN · CoachPSN');
  });

  it('keeps an assigned GM readable without identity fields', () => {
    render(<SeatGmLabel gm={{ ...gm, gm_primary_identity: null, gm_platform: null, gm_gamertag: null }} seatId="seat-2" />);
    expect(screen.getByTestId('text-seat-gm-seat-2').textContent).toContain('Commissioner Coach');
  });
});