import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import Hub from '@/pages/Hub';
import Login from '@/pages/Login';
import CreateLeague from '@/pages/CreateLeague';
import ManageLeague from '@/pages/ManageLeague';
import CreateSeason from '@/pages/CreateSeason';
import Schedule from '@/pages/Schedule';
import Availability from '@/pages/Availability';
import ReportResult from '@/pages/ReportResult';
import ConfirmResult from '@/pages/ConfirmResult';

const queryClient = new QueryClient();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect happens in an effect, never during render.
  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation('/login');
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading) {
    return <div className="loading-screen">Authenticating...</div>;
  }

  if (!isAuthenticated) {
    return <div className="loading-screen">Redirecting...</div>;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/leagues/new">
        <AuthGate>
          <CreateLeague />
        </AuthGate>
      </Route>
      <Route path="/leagues/:id/manage">
        <AuthGate>
          <ManageLeague />
        </AuthGate>
      </Route>
      <Route path="/leagues/:id/season/new">
        <AuthGate>
          <CreateSeason />
        </AuthGate>
      </Route>
      <Route path="/leagues/:id/schedule">
        <AuthGate>
          <Schedule />
        </AuthGate>
      </Route>
      <Route path="/leagues/:id/availability">
        <AuthGate>
          <Availability />
        </AuthGate>
      </Route>
      <Route path="/games/:gameId/report">
        <AuthGate>
          <ReportResult />
        </AuthGate>
      </Route>
      <Route path="/results/:resultId/confirm">
        <AuthGate>
          <ConfirmResult />
        </AuthGate>
      </Route>
      <Route path="/">
        <AuthGate>
          <Hub />
        </AuthGate>
      </Route>
      <Route>
        <AuthGate>
          <div className="empty-state" style={{ margin: '40px auto', maxWidth: '600px' }}>
            <h2>404 - Not Found</h2>
            <p style={{color: 'var(--steel)', fontFamily: 'var(--data)', fontSize: '12px', marginTop: '10px', textTransform: 'uppercase', letterSpacing: '.1em'}}>The page you are looking for does not exist.</p>
          </div>
        </AuthGate>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;