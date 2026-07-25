import { useAuth } from '@workspace/replit-auth-web';
import { useLocation } from 'wouter';

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <div className="loading-screen">Authenticating...</div>;
  
  if (isAuthenticated) {
    setLocation('/');
    return null;
  }

  return (
    <div className="login-page">
       <div className="login-panel">
         <h1>Front Office</h1>
         <p>NHL 27 Connected Franchise Hub</p>
         <button className="btn" onClick={login}>GM Sign In</button>
       </div>
    </div>
  );
}
