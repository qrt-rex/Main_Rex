import { useState, useEffect, type FormEvent } from 'react';
import { 
  ArrowLeft, 
  Eye, 
  EyeOff, 
  Info, 
  Mail, 
  Lock, 
  User, 
  ShieldCheck, 
  Clock, 
  Calendar
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { api, ApiError } from '../lib/api';
import { useToast } from '../components/common/ToastContext';

type Step = 'credentials' | 'otp' | 'forgot' | 'reset';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function DevCode({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 p-3 text-xs text-indigo-800 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-300 animate-pop-in">
      <Info size={15} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
      <div>
        <span className="font-semibold">Simulated Verification Code:</span>{' '}
        <span className="font-mono font-bold text-sm tracking-widest text-indigo-700 dark:text-indigo-300">{code}</span>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { startLogin, verifyOtp, resendOtp, signOutReason } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    run(async () => {
      await api.post('/api/auth/forgot-password', { email: email.trim() });
      go('reset');
      showToast('If this email belongs to an account, a reset code is on its way.', 'info');
    }, 'Could not send a reset code.');
  };

  const submitReset = (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    run(async () => {
      await api.post('/api/auth/reset-password', { email: email.trim(), otp, new_password: newPassword });
      setNewPassword('');
      setPassword('');
      go('credentials');
      showToast('Password updated. Sign in with your new password.', 'success');
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
                  <form onSubmit={submitCredentials} noValidate className="space-y-5 animate-fade-in">
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
                  <form onSubmit={submitForgot} noValidate className="space-y-5 animate-slide-in-right">
                    <div className="text-left space-y-1">
                      <h3 className="text-base font-bold text-white">Reset Your Password</h3>
                      <p className="text-xs text-slate-400">
                        Enter your email address to receive a secure password reset token.
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
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3.5 pl-13 pr-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
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
                        {busy ? 'Sending...' : 'Send Reset Code'}
                      </button>
                    </div>
                  </form>
                )}

                {/* STEP 4: RESET PASSWORD */}
                {step === 'reset' && (
                  <form onSubmit={submitReset} noValidate className="space-y-4 animate-slide-in-right">
                    <div className="text-left space-y-1">
                      <h3 className="text-base font-bold text-white">Set New Password</h3>
                      <p className="text-xs text-slate-400">Enter the 6-digit OTP code and choose a new password.</p>
                    </div>

                    <input
                      type="text"
                      required
                      placeholder="6-digit reset code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3 px-4 text-center font-mono font-bold tracking-widest text-sm text-white"
                    />

                    <input
                      type="password"
                      required
                      placeholder="New password (min 8 characters)"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-full border border-slate-700 bg-[#0d1624] py-3 px-4 text-sm text-white"
                    />

                    <DevCode code={devCode} />
                    {error && <p role="alert" className="text-xs font-semibold text-rose-400 pl-2">{error}</p>}

                    <div className="flex items-center justify-between pt-1">
                      <button type="button" onClick={() => go('credentials')} className="text-xs font-semibold text-slate-400 hover:text-white">
                        Cancel
                      </button>
                      <button type="submit" disabled={busy} className="rounded-full bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-indigo-700">
                        {busy ? 'Updating...' : 'Save New Password'}
                      </button>
                    </div>
                  </form>
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
