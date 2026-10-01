import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Eye, 
  EyeOff, 
  Mail, 
  Lock, 
  User, 
  ShieldCheck, 
  Clock, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Info
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/common/ToastContext';

type Step = 'credentials' | 'otp' | 'forgot' | 'reset';

const ALLOWED_DOMAINS = ['@rexera.co.in', '@rexera.in', '@rexera.com'];

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function GoogleIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

// Only shown on the Vite dev server; production builds never render the code.
function DevCode({ code }: { code?: string | null }) {
  if (!import.meta.env.DEV || !code) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 p-3 text-xs text-indigo-800 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300 animate-pop-in">
      <Info size={15} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
      <div>
        <span className="font-semibold">Dev mode OTP:</span>{' '}
        <span className="font-mono font-bold text-sm tracking-widest text-indigo-700 dark:text-indigo-300">{code}</span>
      </div>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const { startLogin, verifyOtp, resendOtp, loginWithGoogle, signOutReason } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [tokenChecking, setTokenChecking] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Check URL params for reset link (?token=...&email=...) or /reset-password
  useEffect(() => {
    const tokenParam = searchParams.get('token');
    const emailParam = searchParams.get('email');
    if (tokenParam || location.pathname === '/reset-password') {
      setStep('reset');
      if (tokenParam) setResetToken(tokenParam);
      if (emailParam) setEmail(emailParam);

      if (tokenParam && emailParam) {
        setTokenChecking(true);
        api.get<{ valid: boolean; message: string }>(`/api/auth/verify-reset-token?token=${encodeURIComponent(tokenParam)}&email=${encodeURIComponent(emailParam)}`)
          .then((res) => {
            if (res && !res.valid) {
              setTokenError(res.message || 'This reset link has expired or is invalid.');
            } else {
              setTokenError(null);
            }
          })
          .catch(() => {
            // Allow submission to validate
          })
          .finally(() => setTokenChecking(false));
      }
    }
  }, [searchParams, location.pathname]);

  // Google OAuth state
  const tokenClientRef = useRef<any>(null);
  // Stays empty (and the Google button hidden) until the backend has GOOGLE_CLIENT_ID set.
  const [googleClientId, setGoogleClientId] = useState<string>('');

  // Fetch Google OAuth configuration
  useEffect(() => {
    api.get<{ client_id: string; allowed_domains: string[] }>('/api/auth/google/config')
      .then((cfg) => {
        if (cfg?.client_id) setGoogleClientId(cfg.client_id);
      })
      .catch(() => undefined);
  }, []);

  // Initialize Google OAuth2 Token Client for seamless custom-themed button
  useEffect(() => {
    if (!googleClientId) return;

    let timer: any;
    const initClient = () => {
      const gOauth2 = (window as any).google?.accounts?.oauth2;
      if (!gOauth2) return false;
      try {
        tokenClientRef.current = gOauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'openid email profile',
          callback: async (tokenResponse: any) => {
            if (tokenResponse?.error) {
              setError(tokenResponse.error_description || 'Google sign-in was cancelled or failed.');
              return;
            }
            if (tokenResponse?.access_token) {
              run(async () => {
                await loginWithGoogle({ access_token: tokenResponse.access_token });
                showToast('Signed in with Google', 'success');
              }, 'Google authentication failed.');
            }
          },
        });
        return true;
      } catch (err) {
        console.error('Google OAuth client init error:', err);
        return false;
      }
    };

    if (!initClient()) {
      timer = setInterval(() => {
        if (initClient()) clearInterval(timer);
      }, 200);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [googleClientId, loginWithGoogle, showToast]);

  const handleGoogleSignInClick = () => {
    setError('');
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
    } else if (googleClientId && (window as any).google?.accounts?.oauth2) {
      const tc = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'openid email profile',
        callback: async (resp: any) => {
          if (resp?.access_token) {
            run(async () => {
              await loginWithGoogle({ access_token: resp.access_token });
              showToast('Signed in with Google', 'success');
            }, 'Google authentication failed.');
          }
        },
      });
      tokenClientRef.current = tc;
      tc.requestAccessToken({ prompt: 'select_account' });
    } else {
      setError('Google sign-in is still loading. Please try again in a moment.');
    }
  };

  // Digital Clock state (Indian Standard Time - New Delhi / IST)
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');
  const [timePeriod, setTimePeriod] = useState<string>('');

  // Live Digital Clock (Delhi / IST)
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      
      const timeParts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).formatToParts(now);

      const hour = timeParts.find(p => p.type === 'hour')?.value || '12';
      const minute = timeParts.find(p => p.type === 'minute')?.value || '00';
      const second = timeParts.find(p => p.type === 'second')?.value || '00';
      const dayPeriod = timeParts.find(p => p.type === 'dayPeriod')?.value?.toUpperCase() || 'AM';

      setTimeStr(`${hour}:${minute}:${second}`);
      setTimePeriod(dayPeriod);

      const dateFormatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(now);

      setDateStr(dateFormatted);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const go = (next: Step) => {
    setError('');
    setOtp('');
    setForgotSent(false);
    setTokenError(null);
    if (next !== step) setDevCode(null);
    setStep(next);
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    run(async () => {
      const res = await startLogin(email.trim(), password);
      setTempToken(res.temp_token);
      go('otp');
      setDevCode(res.debug_otp);
    }, 'Unable to sign in.');
  };

  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    run(async () => {
      await verifyOtp(email.trim(), otp, tempToken);
      setPassword('');
      setTempToken('');
      showToast('Signed in successfully', 'success');
    }, 'Verification failed.');
  };

  const resend = () =>
    run(async () => {
      setDevCode(await resendOtp(email.trim(), tempToken));
      showToast('A new code has been sent', 'info');
    }, 'Could not resend the code.');

  const submitForgot = (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }
    const isAllowed = ALLOWED_DOMAINS.some((d) => cleanEmail.endsWith(d));
    if (!isAllowed) {
      setError('Only email addresses ending in @rexera.in, @rexera.com, or @rexera.co.in are allowed.');
      return;
    }
    run(async () => {
      await api.post('/api/auth/forgot-password', { email: cleanEmail });
      setForgotSent(true);
      setError('');
      showToast('A password reset link has been sent to your email.', 'info');
    }, 'Could not send the password reset link.');
  };

  const submitReset = (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please verify both fields.');
      return;
    }
    const activeToken = resetToken.trim() || otp.trim();
    if (!activeToken) {
      setError('Reset token is missing. Please click the link sent to your email.');
      return;
    }
    run(async () => {
      await api.post('/api/auth/reset-password', {
        email: email.trim(),
        token: activeToken,
        otp: activeToken,
        new_password: newPassword
      });
      setNewPassword('');
      setConfirmPassword('');
      setPassword('');
      setResetToken('');
      setOtp('');
      showToast('Password updated successfully! Please sign in with your new password.', 'success');
      go('credentials');
      navigate('/login', { replace: true });
    }, 'Could not reset the password.');
  };

  const notice =
    step === 'credentials' && signOutReason === 'timeout'
      ? 'You were signed out after a period of inactivity.'
      : step === 'credentials' && signOutReason === 'expired'
        ? 'Your session has ended. Please sign in again.'
        : null;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#0a101d] text-slate-100 flex flex-col justify-between selection:bg-indigo-600 selection:text-white font-sans">
      
      {/* Background Ambient Glow */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-30">
        <div className="absolute -left-[10%] -top-[10%] h-[600px] w-[600px] rounded-full bg-gradient-to-br from-indigo-600 via-violet-600 to-transparent blur-[120px]" />
        <div className="absolute -right-[10%] top-[30%] h-[600px] w-[600px] rounded-full bg-gradient-to-bl from-teal-500 via-indigo-600 to-transparent blur-[130px]" />
      </div>



      {/* Main Container: Open Notebook Design */}
      <main className="relative z-20 flex-1 flex flex-col items-center justify-center px-4 sm:px-8 lg:px-12 py-4 max-w-[1400px] mx-auto w-full">
        
        {/* Sleek Minimal Digital Clock (Indian Standard Time - Delhi) */}
        <div className="mb-4 flex items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-[#121c2e]/90 px-6 py-2 shadow-lg backdrop-blur-md">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800/60">
              <Clock size={15} className="animate-pulse" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg sm:text-xl font-extrabold tracking-tight text-white">
                {timeStr || '12:00:00'}
              </span>
              <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                {timePeriod || 'IST'}
              </span>
            </div>
            <div className="h-4 w-px bg-slate-700 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Calendar size={13} className="text-indigo-400" />
              <span>{dateStr || 'Saturday, 26 September 2026'}</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* THE OPEN NOTEBOOK CONTAINER (Left Page + Center Spine + Right Page) */}
        {/* ========================================================================= */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 rounded-3xl border border-slate-700/80 bg-[#131d2e] shadow-2xl overflow-hidden relative backdrop-blur-xl min-h-[540px] lg:min-h-[620px] xl:min-h-[680px]">
          
          {/* Subtle Spine Divider in Center on Large Screens */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-8 -translate-x-1/2 bg-gradient-to-r from-transparent via-[#0b121e]/80 to-transparent z-10 pointer-events-none" />

          {/* ========================================================================= */}
          {/* LEFT PAGE: VIDEO ONLY (WITHOUT SOUND) */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 relative overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-700/80 min-h-[360px] lg:min-h-[620px] xl:min-h-[680px] flex items-center justify-center bg-[#131d2e]">
            <video
              src="/login-video.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover object-[15%_center] scale-[1.22] origin-left pointer-events-none"
            />
          </div>

          {/* ========================================================================= */}
          {/* RIGHT PAGE: LOGIN & AUTH FORM */}
          {/* ========================================================================= */}
          <div className="lg:col-span-6 p-8 sm:p-12 lg:p-14 xl:p-16 flex flex-col justify-center bg-[#131e31]">
            
            {/* Header: Logo & Login */}
            <div className="mb-8 flex items-center justify-between border-b border-slate-700/80 pb-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center bg-white rounded-2xl p-2 shadow-xl shrink-0 border border-slate-200">
                  <img src="/rex-logo.jpeg" alt="Rexera Logo" className="h-12 sm:h-14 w-auto max-w-[160px] object-contain rounded-xl" />
                </div>
                <div>
                  <span className="text-xl sm:text-2xl font-black tracking-tight text-white block leading-tight">REXERA</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">CRM</span>
                </div>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-indigo-400">
                Login
              </h2>
            </div>

            {notice && (
                  <div role="status" className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/40 p-3 text-xs text-amber-300 animate-pop-in">
                    {notice}
                  </div>
                )}

                {/* STEP 1: CREDENTIALS */}
                {step === 'credentials' && (
                  <div className="space-y-4 animate-fade-in">
                    {/* Google Sign In Button - Styled strictly to theme */}
                    {googleClientId && <div className="space-y-3">
                      <button
                        type="button"
                        onClick={handleGoogleSignInClick}
                        disabled={busy}
                        className="group relative flex w-full items-center justify-center gap-3 rounded-full border border-slate-700 bg-[#0d1624] py-3.5 px-6 text-sm font-semibold text-white shadow-md transition-all hover:border-indigo-500/60 hover:bg-[#152136] hover:shadow-indigo-500/10 active:scale-[0.99] disabled:opacity-60 cursor-pointer"
                      >
                        <GoogleIcon className="h-5 w-5 shrink-0" />
                        <span>Sign in with Google</span>
                      </button>

                      <div className="relative flex items-center justify-center pt-1">
                        <div className="w-full border-t border-slate-800" />
                        <span className="absolute bg-[#131e31] px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                          or sign in with password
                        </span>
                      </div>
                    </div>}

                    <form onSubmit={submitCredentials} noValidate className="space-y-4">
                      {/* Email Input */}
                      <div className="relative group">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                          <User size={16} />
                        </div>
                        <input
                          type="email"
                          autoComplete="username"
                          required
                          autoFocus
                          placeholder="Email or username"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3.5 pl-13 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        />
                      </div>

                      {/* Password Input */}
                      <div className="relative group">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                          <Lock size={16} />
                        </div>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          required
                          placeholder="Password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3.5 pl-13 pr-12 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                      </div>

                      {error && (
                        <p role="alert" className="text-xs font-semibold text-rose-400 pl-2 animate-pop-in">
                          {error}
                        </p>
                      )}

                      {/* Actions Row */}
                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => go('forgot')}
                          className="text-xs font-semibold text-slate-400 hover:text-indigo-400 transition-colors"
                        >
                          Forgot your password?
                        </button>

                        <button
                          type="submit"
                          disabled={busy}
                          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-indigo-700 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 hover:from-indigo-700 hover:to-indigo-800 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60"
                        >
                          {busy ? (
                            <div className="flex items-center gap-2">
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              <span>Signing in...</span>
                            </div>
                          ) : (
                            'Login'
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* STEP 2: 2FA OTP */}
                {step === 'otp' && (
                  <form onSubmit={submitOtp} noValidate className="space-y-5 animate-slide-in-right">
                    <div className="text-left space-y-1">
                      <div className="flex items-center gap-2 text-indigo-400">
                        <Mail size={18} />
                        <h3 className="text-base font-bold text-white">Check Your Email</h3>
                      </div>
                      <p className="text-xs text-slate-400">
                        We sent a 6-digit verification code to <span className="font-bold text-slate-200">{email}</span>
                      </p>
                    </div>

                    <div className="relative group">
                      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-400">
                        <ShieldCheck size={16} />
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        autoFocus
                        placeholder="0 0 0 0 0 0"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3.5 pl-13 pr-4 text-center text-lg font-mono font-bold tracking-[0.4em] text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>

                    <DevCode code={devCode} />

                    {error && (
                      <p role="alert" className="text-xs font-semibold text-rose-400 pl-2">
                        {error}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => go('credentials')}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
                      >
                        <ArrowLeft size={14} /> Back
                      </button>
                      <button
                        type="button"
                        onClick={resend}
                        disabled={busy}
                        className="text-xs font-bold text-indigo-400 hover:underline disabled:opacity-50"
                      >
                        Resend Code
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-700 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 hover:from-indigo-700 hover:to-indigo-800 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-60"
                    >
                      {busy ? 'Verifying...' : 'Verify and Sign In'}
                    </button>
                  </form>
                )}

                {/* STEP 3: FORGOT PASSWORD */}
                {step === 'forgot' && (
                  forgotSent ? (
                    <div className="space-y-5 animate-slide-in-right text-center py-2">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                        <CheckCircle2 size={32} />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg font-bold text-white">Reset Link Sent!</h3>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          We have sent a secure password reset link to <br />
                          <span className="font-semibold text-indigo-400">{email}</span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Please check your inbox (and spam folder). The link will expire in 15 minutes.
                        </p>
                      </div>

                      <div className="pt-2 space-y-3">
                        <button
                          type="button"
                          onClick={() => go('credentials')}
                          className="w-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-700 py-3 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 hover:from-indigo-700 hover:to-indigo-800 transition-all"
                        >
                          Back to Sign In
                        </button>
                        <div>
                          <button
                            type="button"
                            onClick={() => { setForgotSent(false); setError(''); }}
                            className="text-xs font-medium text-slate-400 hover:text-white transition-colors"
                          >
                            Didn't receive the email? Try again
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={submitForgot} noValidate className="space-y-5 animate-slide-in-right">
                      <div className="text-left space-y-1">
                        <h3 className="text-base font-bold text-white">Reset Your Password</h3>
                        <p className="text-xs text-slate-400">
                          Enter your official Rexera email to receive a secure password reset link.
                        </p>
                      </div>

                      <div className="relative group">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-400">
                          <Mail size={16} />
                        </div>
                        <input
                          type="email"
                          required
                          autoFocus
                          placeholder="your.email@rexera.co.in"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setError(''); }}
                          className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3.5 pl-13 pr-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-slate-500">
                        <span>Allowed domains:</span>
                        <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-slate-400">@rexera.in</span>
                        <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-slate-400">@rexera.com</span>
                        <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-slate-400">@rexera.co.in</span>
                      </div>

                      {error && <p role="alert" className="text-xs font-semibold text-rose-400 pl-2">{error}</p>}

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => go('credentials')}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white"
                        >
                          <ArrowLeft size={14} /> Back to login
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded-full bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-700 transition-all disabled:opacity-60"
                        >
                          {busy ? 'Sending...' : 'Send Reset Link'}
                        </button>
                      </div>
                    </form>
                  )
                )}

                {/* STEP 4: RESET PASSWORD */}
                {step === 'reset' && (
                  tokenError ? (
                    <div className="space-y-5 animate-slide-in-right text-center py-2">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400">
                        <AlertCircle size={32} />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg font-bold text-white">Invalid or Expired Link</h3>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {tokenError}
                        </p>
                      </div>
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => go('forgot')}
                          className="w-full rounded-full bg-indigo-600 py-3 text-xs font-bold text-white hover:bg-indigo-700 transition-all"
                        >
                          Request a New Reset Link
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={submitReset} noValidate className="space-y-4 animate-slide-in-right">
                      <div className="text-left space-y-1">
                        <h3 className="text-base font-bold text-white">Create New Password</h3>
                        <p className="text-xs text-slate-400">
                          {tokenChecking ? 'Verifying link...' : <>Enter a new secure password for <span className="text-indigo-400 font-semibold">{email || 'your account'}</span>.</>}
                        </p>
                      </div>

                      {!resetToken && (
                        <div className="relative group">
                          <input
                            type="text"
                            required
                            placeholder="6-digit reset code or token"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.trim())}
                            className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3 px-4 text-center font-mono font-bold tracking-widest text-sm text-white"
                          />
                        </div>
                      )}

                      <div className="relative group">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-400">
                          <Lock size={16} />
                        </div>
                        <input
                          type={showNewPassword ? 'text' : 'password'}
                          required
                          placeholder="New password (min 8 characters)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3 pl-13 pr-11 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          tabIndex={-1}
                        >
                          {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>

                      <div className="relative group">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-indigo-400">
                          <Lock size={16} />
                        </div>
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          placeholder="Confirm new password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3 pl-13 pr-11 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          tabIndex={-1}
                        >
                          {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>

                      {error && <p role="alert" className="text-xs font-semibold text-rose-400 pl-2">{error}</p>}

                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() => go('credentials')}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-white"
                        >
                          <ArrowLeft size={14} /> Back to Sign In
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded-full bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 hover:from-indigo-700 hover:to-indigo-800 transition-all disabled:opacity-60"
                        >
                          {busy ? 'Saving...' : 'Save New Password'}
                        </button>
                      </div>
                    </form>
                  )
                )}


          </div>

        </div>

      </main>

      {/* Footer Minimalist Bar */}
      <footer className="relative z-20 flex items-center justify-center px-6 sm:px-12 lg:px-16 py-4 text-xs text-slate-500 border-t border-slate-800/80 bg-[#0b121e]/80 backdrop-blur-xs">
        <p>© 2026 Rexera Financial Services Private Limited. All rights reserved.</p>
      </footer>
    </div>
  );
}
