import {
  useGetMyLeagues,
  useGetLeagueHub,
  League,
  LeagueHub,
  Notification,
  HubApplicantActivity,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import Header from '@/components/Header';
import LeagueSlab from '@/components/LeagueSlab';
import MyWeek from '@/components/MyWeek';
import Standings from '@/components/Standings';
import Sidebar from '@/components/Sidebar';

function NewFeatureCallouts({ league }: { league?: League }) {
  const features = [
    {
      label: 'Player Profile',
      title: 'Add and verify your console identities',
      description: 'Keep your systems, gamertags, primary identity, and time zone ready for league applications.',
      href: '/profile',
      action: 'Open profile',
      testId: 'link-hub-profile-feature',
    },
    {
      label: 'Notification Center',
      title: 'Choose how league updates reach you',
      description: 'Review announcements, results, and schedule updates, then set in-app, email, and digest preferences.',
      href: '/notifications',
      action: 'Open inbox',
      testId: 'link-hub-notifications-feature',
    },
    ...(league ? [{
      label: 'Commissioner Tools',
      title: 'Build from curated league settings',
      description: 'Apply a template, customize every field, and preserve an immutable settings history for each season.',
      href: `/leagues/${league.id}/manage`,
      action: 'Manage league',
      testId: 'link-hub-settings-feature',
    }] : []),
  ];

  return (
    <section className="hub-feature-callouts" aria-labelledby="hub-feature-title">
      <div className="hub-feature-head">
        <div>
          <div className="hub-feature-kicker">New in Front Office</div>
          <h2 id="hub-feature-title">More control, fewer loose ends.</h2>
        </div>
        <span>Identity · Settings · Communications</span>
      </div>
      <div className="hub-feature-grid">
        {features.map((feature) => (
          <article className="hub-feature-card" key={feature.label}>
            <div className="hub-feature-label">{feature.label}</div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
            <Link href={feature.href} className="hub-feature-link" data-testid={feature.testId}>
              {feature.action} →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function HubActivity({
  hub,
  league,
  isLoading,
}: {
  hub?: LeagueHub;
  league: League;
  isLoading: boolean;
}) {
  const notifications = hub?.recent_notifications ?? [];
  const applicants = hub?.applicant_activity ?? [];

  return (
    <section className="hub-activity" aria-labelledby="hub-activity-title">
      <div className="hub-activity-head">
        <div>
          <div className="hub-feature-kicker">League activity</div>
          <h2 id="hub-activity-title">Inbox and applicant intake</h2>
        </div>
        <Link href="/notifications" className="hub-feature-link">
          Open inbox{hub?.unread_notification_count ? ` (${hub.unread_notification_count})` : ''} →
        </Link>
      </div>
      <div className="hub-activity-grid">
        <div className="hub-activity-column">
          <div className="hub-activity-label">Recent notifications</div>
          {isLoading ? (
            <div className="hub-activity-empty">Loading notifications…</div>
          ) : notifications.length === 0 ? (
            <div className="hub-activity-empty">No recent notifications.</div>
          ) : notifications.map((notification: Notification) => (
            <Link
              key={notification.id}
              href="/notifications"
              className={`hub-activity-row ${notification.read_at ? '' : 'unread'}`}
            >
              <span>
                <strong>{notification.title}</strong>
                <small>{notification.body}</small>
              </span>
              <time>{new Date(notification.created_at).toLocaleDateString()}</time>
            </Link>
          ))}
        </div>
        <div className="hub-activity-column">
          <div className="hub-activity-label">Pending applicants</div>
          {isLoading ? (
            <div className="hub-activity-empty">Loading applicant activity…</div>
          ) : applicants.length === 0 ? (
            <div className="hub-activity-empty">No pending applicant activity.</div>
          ) : applicants.map((applicant: HubApplicantActivity) => (
            <Link
              key={`${applicant.source}-${applicant.id}`}
              href={`/leagues/${league.id}/manage`}
              className="hub-activity-row"
            >
              <span>
                <strong>{applicant.display_name || 'Applicant'}</strong>
                <small>
                  {applicant.source === 'invite_request'
                    ? 'Invite request'
                    : applicant.source === 'waitlist'
                      ? `Waitlist · ${applicant.status}`
                      : 'Public sign-up'}
                </small>
              </span>
              <time>{new Date(applicant.created_at).toLocaleDateString()}</time>
            </Link>
          ))}
          {applicants.length > 0 && (
            <Link href={`/leagues/${league.id}/manage`} className="hub-activity-action">
              Review applicants →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function LeagueDashboard({ league }: { league: League }) {
  const { data: hub, isLoading, isError } = useGetLeagueHub(league.id);

  return (
    <>
      <LeagueSlab hub={hub} isLoading={isLoading} />
      <div className="wrap">
        <NewFeatureCallouts league={league} />
        <HubActivity hub={hub} league={league} isLoading={isLoading} />
        <div className="cols">
          <main>
            <MyWeek games={hub?.my_games_this_week || []} isLoading={isLoading} />
            {hub?.active_season_id ? (
              <Standings seasonId={hub.active_season_id} />
            ) : (
              <section className="panel" id="standings">
                <div className="panel-head"><h2>Standings</h2></div>
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--steel)' }}>No active season.</div>
              </section>
            )}
          </main>
          <Sidebar
            leagueId={league.id}
            wire={hub?.wire_transactions ?? []}
            openSeats={hub?.open_seat_details ?? []}
            isLoading={isLoading}
            isError={isError}
          />
        </div>
      </div>
    </>
  );
}

export default function Hub() {
  const { data: leaguesResponse, isLoading } = useGetMyLeagues();
  const leagues = leaguesResponse?.data || [];
  const activeLeague = leagues[0];

  if (isLoading) return <div className="loading-screen">Loading Front Office...</div>;

  return (
    <>
      <Header league={activeLeague} />
      {activeLeague ? (
        <LeagueDashboard league={activeLeague} />
      ) : (
        <div className="wrap">
          <NewFeatureCallouts />
          <div className="empty-state">
            <h2>Welcome to Front Office</h2>
            <p style={{color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em'}}>You aren't in any leagues yet.</p>
            <div style={{ marginTop: '20px' }}>
              <Link href="/leagues/new" className="btn">Create League</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
