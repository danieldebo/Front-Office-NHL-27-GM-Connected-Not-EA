import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Sidebar from './Sidebar';

const renderSidebar = (props: Partial<React.ComponentProps<typeof Sidebar>> = {}) => {
  const { hook } = memoryLocation({ path: '/' });
  return render(
    <Router hook={hook}>
      <Sidebar
        leagueId="league-1"
        wire={[]}
        openSeats={[]}
        isLoading={false}
        isError={false}
        {...props}
      />
    </Router>,
  );
};

describe('Sidebar live data', () => {
  it('renders explicit empty states instead of sample transactions or seats', () => {
    renderSidebar();
    expect(screen.getByText('No transactions yet.')).toBeTruthy();
    expect(screen.getByText('No open seats.')).toBeTruthy();
    expect(screen.queryByText(/Marchment|Nazar|NSH|SJS|ANA/)).toBeNull();
  });

  it('renders real wire and open-seat records with a filtered applicant link', () => {
    renderSidebar({
      wire: [{
        id: 'txn-1',
        season_id: 'season-1',
        type: 'signing',
        status: 'approved',
        proposed_at: new Date().toISOString(),
        assets: [],
        summary: 'Real Club signs Real Player',
        provenance: 'commissioner',
        cap_checked: true,
        approved_by: 'Commissioner',
      }],
      openSeats: [{
        team_season_id: 'seat-1',
        franchise_id: 'franchise-1',
        franchise_name: 'Real Club',
        state: 'vacated',
        applicant_count: 2,
      }],
    });

    expect(screen.getByText('Real Club signs Real Player')).toBeTruthy();
    expect(screen.getByText(/Approved by Commissioner/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('href'))
      .toBe('/leagues/league-1/manage?tab=applicants&seat=seat-1');
  });
});