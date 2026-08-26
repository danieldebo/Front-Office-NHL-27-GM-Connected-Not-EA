import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
} from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import Hub from '@/pages/Hub';
import LandingPage from '@/pages/LandingPage';
import CreateLeague from '@/pages/CreateLeague';
import ManageLeague from '@/pages/ManageLeague';
import CreateSeason from '@/pages/CreateSeason';
import Schedule from '@/pages/Schedule';
import Availability from '@/pages/Availability';
import ReportResult from '@/pages/ReportResult';
import ConfirmResult from '@/pages/ConfirmResult';
import LeaguePublic from '@/pages/LeaguePublic';
import DqFindings from '@/pages/DqFindings';
import JoinInvite from '@/pages/JoinInvite';
import JoinByCode from '@/pages/JoinByCode';
import OpenLeagues from '@/pages/OpenLeagues';
import Footer from '@/components/Footer';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2F6FB5',
    colorForeground: '#0E1620',
    colorMutedForeground: '#5C6B78',
    colorDanger: '#B33A2B',
    colorBackground: '#FFFFFF',
    colorInput: '#FFFFFF',
    colorInputForeground: '#0E1620',
    colorNeutral: '#D3DBE2',
    fontFamily: "'Public Sans', system-ui, sans-serif",
    borderRadius: '3px',
  },
};

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect happens in an effect, never during render.
  React.useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation('/sign-in');
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded) {
    return <div className="loading-screen">Authenticating...</div>;
  }

  if (!isSignedIn) {
    return <div className="loading-screen">Redirecting...</div>;
  }

  return <>{children}</>;
}

function RootRoute() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (!isSignedIn) {
    return <LandingPage />;
  }

  return <Hub />;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?">
        <div className="clerk-page">
          <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
        </div>
      </Route>
      <Route path="/sign-up/*?">
        <div className="clerk-page">
          <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
        </div>
      </Route>
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
      <Route path="/leagues/:id/dq">
        <AuthGate>
          <DqFindings />
        </AuthGate>
      </Route>
      {/* Public routes — no AuthGate */}
      <Route path="/leagues/open" component={OpenLeagues} />
      <Route path="/l/:slug" component={LeaguePublic} />
      <Route path="/join/:token" component={JoinInvite} />
      <Route path="/j/:code" component={JoinByCode} />
      <Route path="/" component={RootRoute} />
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

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    return addListener(({ user }) => {
      const nextUserId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
        client.clear();
      }
      previousUserId.current = nextUserId;
    });
  }, [addListener, client]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to access Front Office',
          },
        },
        signUp: {
          start: {
            title: 'Create your Front Office account',
            subtitle: 'Get started with connected-franchise league tools',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}>
            <Router />
          </div>
          <Footer />
        </div>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;