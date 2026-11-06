import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { createAccount, friendlyError, isProviderEnabled, supabase } from '../api';
import { PHOTOS, photoUrl } from '../images';
import { useAuth, useStorefront } from '../store';
import { ErrorText, fieldClass, primaryButton, secondaryButton } from '../ui';

type Mode = 'signin' | 'signup' | 'forgot' | 'phone';

// Google shows by default and explains itself if it isn't set up yet. Phone and Apple only
// appear once listed here, after they work in Supabase.
const ENABLED_PROVIDERS = (import.meta.env.VITE_AUTH_PROVIDERS ?? 'google').split(',').map((p: string) => p.trim());

const toE164 = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('254') ? `+${digits}` : `+254${digits.replace(/^0/, '')}`;
};

/** Same rule as fn_normalize_ke_phone in the database. */
const isKenyanMobile = (phone: string) => /^(254|0)?[17]\d{8}$/.test(phone.replace(/\D/g, ''));

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The photo panel beside every sign-in form. It drops away on phones. */
function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { business } = useStorefront();
  return (
    <div className="grid lg:min-h-[44rem] lg:grid-cols-2">
      <div className="relative isolate hidden overflow-hidden bg-hero text-cream lg:block">
        <img src={photoUrl(PHOTOS.pour, 1100, 1300)} alt="" className="hero-photo absolute inset-0 -z-20 size-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />
        <div className="rise-in flex h-full flex-col justify-end p-12 xl:p-16">
          <p className="display-lg max-w-md font-display leading-[1.08]">Your milk, a few taps away.</p>
          <p className="mt-4 max-w-sm text-lg leading-relaxed text-cream/85">
            Order from {business.name}, follow your deliveries, and set up regular orders.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <div className="rise-in w-full max-w-md">
          <h1 className="display-lg">{title}</h1>
          {subtitle && <p className="mt-3 text-lg text-muted">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthForms() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  // Someone who declines on Google's page comes back with an error in the address.
  useEffect(() => {
    const params = new URLSearchParams(`${window.location.search}&${window.location.hash.replace(/^#/, '')}`);
    if (params.get('error')) {
      setError("That sign-in didn't finish. Please try again, or use your email.");
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const signInWith = async (provider: 'google' | 'apple') => {
    setError('');
    setBusy(true);
    const label = provider === 'google' ? 'Google' : 'Apple';
    if (!(await isProviderEnabled(provider))) {
      setError(`${label} sign-in isn't available yet. Please use your email for now.`);
      setBusy(false);
      return;
    }
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/account` },
    });
    if (authError) {
      setError(`We couldn't open ${label} sign-in. Please try another way.`);
      setBusy(false);
    }
  };

  const showProviders = !done && (mode === 'signin' || mode === 'signup');

  const handlePhone = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isKenyanMobile(phone)) {
      setError('Please enter a valid Kenyan phone number, like 0712 345 678.');
      return;
    }
    setBusy(true);
    try {
      if (!codeSent) {
        const { error: authError } = await supabase.auth.signInWithOtp({
          phone: toE164(phone),
          options: { data: { account_type: 'customer' } },
        });
        if (authError) setError("We couldn't send the code. Please try again shortly.");
        else setCodeSent(true);
      } else {
        const { error: authError } = await supabase.auth.verifyOtp({ phone: toE164(phone), token: code, type: 'sms' });
        if (authError) setError('That code is not right, or it has expired.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) setError('That email or password is not right.');
      } else if (mode === 'signup') {
        if (!isKenyanMobile(phone)) {
          setError('Please enter a valid Kenyan phone number, like 0712 345 678.');
          return;
        }
        const { error: authError, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Not "phone": the staff signup trigger copies that key into public.users, where it must be unique,
            // and customers may share a number, such as one family M-Pesa line.
            data: { name, customer_phone: phone, account_type: 'customer' },
            emailRedirectTo: `${window.location.origin}/account`,
          },
        });
        if (authError) {
          setError(authError.message.toLowerCase().includes('password')
            ? 'Please choose a stronger password of at least 8 characters.'
            : "We couldn't create your account. If you already have one, please sign in.");
        } else if (!data.session) {
          setDone('Please check your email and tap the link to confirm your account.');
        }
        // With a session, the auth listener creates the account from the sign-up details.
      } else {
        await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/account` });
        setDone('If that email has an account, a link to reset your password is on its way.');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const titles = { signin: 'Welcome Back', signup: 'Create Your Account', forgot: 'Reset Your Password', phone: 'Use Your Phone Number' };
  const actions = { signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link', phone: 'Send me a code' };
  const subtitles = {
    signin: 'Sign in to order and follow your deliveries.',
    signup: 'It only takes a minute.',
    forgot: "Enter your email and we'll send you a link.",
    phone: "We'll text you a code to sign in.",
  };

  return (
    <AuthLayout title={titles[mode]} subtitle={subtitles[mode]}>
      {showProviders && (
        <div className="mt-8 space-y-2">
          {ENABLED_PROVIDERS.includes('google') && (
            <button type="button" disabled={busy} onClick={() => signInWith('google')} className={`${secondaryButton} w-full`}>
              <GoogleMark /> Continue with Google
            </button>
          )}
          {ENABLED_PROVIDERS.includes('apple') && (
            <button type="button" disabled={busy} onClick={() => signInWith('apple')} className={`${secondaryButton} w-full`}>Continue with Apple</button>
          )}
          {ENABLED_PROVIDERS.includes('phone') && (
            <button type="button" onClick={() => setMode('phone')} className={`${secondaryButton} w-full`}>Continue with phone number</button>
          )}
          {ENABLED_PROVIDERS.some((p: string) => ['google', 'apple', 'phone'].includes(p)) && (
            <p className="flex items-center gap-3 pt-3 text-sm text-muted">
              <span className="h-px flex-1 bg-line" /> or use your email <span className="h-px flex-1 bg-line" />
            </p>
          )}
        </div>
      )}
      {done ? (
        <div role="status" className="card mt-8 p-6 text-center">
          <CheckCircle2 size={36} className="mx-auto text-emerald-700" aria-hidden />
          <p className="mt-3 text-lg">{done}</p>
          <button
            onClick={() => { setDone(''); setMode('signin'); }}
            className={`${secondaryButton} mt-5`}
          >
            Back to sign in
          </button>
        </div>
      ) : mode === 'phone' ? (
        <form onSubmit={handlePhone} className="mt-8 space-y-4">
          <label className="block font-medium">
            Phone number
            <input required type="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} disabled={codeSent} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
          </label>
          {codeSent && (
            <label className="block font-medium">
              Code we sent you
              <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className={fieldClass} />
            </label>
          )}
          <ErrorText>{error}</ErrorText>
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
            {busy ? 'Please wait…' : codeSent ? 'Sign in' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className={`${showProviders ? 'mt-4' : 'mt-8'} space-y-4`}>
          {mode === 'signup' && (
            <>
              <label className="block font-medium">
                Your name
                <input required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
              </label>
              <label className="block font-medium">
                M-Pesa phone number
                <input required type="tel" autoComplete="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
              </label>
            </>
          )}
          <label className="block font-medium">
            Email
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
          </label>
          {mode !== 'forgot' && (
            <label className="block font-medium">
              Password
              <input
                required
                type="password"
                minLength={8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
              />
            </label>
          )}
          <ErrorText>{error}</ErrorText>
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
            {busy ? 'Please wait…' : actions[mode]}
          </button>
        </form>
      )}
      {!done && (
        <div className="mt-6 space-y-1 text-center">
          {mode === 'signin' && (
            <>
              <button onClick={() => setMode('signup')} className="block min-h-11 w-full font-medium text-brand-deep underline">New here? Create an account</button>
              <button onClick={() => setMode('forgot')} className="block min-h-11 w-full text-muted underline">Forgot your password?</button>
            </>
          )}
          {mode !== 'signin' && (
            <button onClick={() => setMode('signin')} className="block min-h-11 w-full font-medium text-brand-deep underline">Back to sign in</button>
          )}
        </div>
      )}
    </AuthLayout>
  );
}

/** Asks for the details a confirmed login is missing, which Google doesn't provide. */
export function FinishAccountForm() {
  const session = useAuth((s) => s.session);
  const [name, setName] = useState(session?.user.user_metadata?.name ?? session?.user.user_metadata?.full_name ?? '');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createAccount(name, phone);
      await useAuth.getState().refreshAccount();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="One Last Step" subtitle="Add the M-Pesa number you'll pay with.">
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block font-medium">
          Your name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </label>
        <label className="block font-medium">
          M-Pesa phone number
          <input required type="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
        </label>
        <ErrorText>{error}</ErrorText>
        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>Continue</button>
      </form>
    </AuthLayout>
  );
}

export function NewPasswordForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: authError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (authError) {
      setError('Please choose a different password of at least 8 characters.');
      return;
    }
    useAuth.getState().setRecovering(false);
  };

  return (
    <AuthLayout title="Choose a New Password">
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block font-medium">
          New password
          <input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
        </label>
        <ErrorText>{error}</ErrorText>
        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>Save password</button>
      </form>
    </AuthLayout>
  );
}
