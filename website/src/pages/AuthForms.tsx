import { FormEvent, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { createAccount, friendlyError, supabase } from '../api';
import { useAuth } from '../store';
import { ErrorText, fieldClass, pageClass, primaryButton, secondaryButton } from '../ui';

type Mode = 'signin' | 'signup' | 'forgot';

/** Same rule as fn_normalize_ke_phone in the database. */
const isKenyanMobile = (phone: string) => /^(254|0)?[17]\d{8}$/.test(phone.replace(/\D/g, ''));

export function AuthForms() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

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

  const titles = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset your password' };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-bold">{titles[mode]}</h1>
      {done ? (
        <div role="status" className="mt-8 rounded-xl border border-line bg-white p-6 text-center">
          <CheckCircle2 size={36} className="mx-auto text-emerald-700" aria-hidden />
          <p className="mt-3 text-lg">{done}</p>
          <button
            onClick={() => { setDone(''); setMode('signin'); }}
            className={`${secondaryButton} mt-5`}
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
            {busy ? 'Please wait…' : titles[mode]}
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
    </div>
  );
}

/** Asks for the details a confirmed login is missing. */
export function FinishAccountForm() {
  const session = useAuth((s) => s.session);
  const [name, setName] = useState(session?.user.user_metadata?.name ?? '');
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
    <div className={`${pageClass} max-w-md`}>
      <h1 className="text-4xl font-bold">Finish your account</h1>
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
    </div>
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
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-bold">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block font-medium">
          New password
          <input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
        </label>
        <ErrorText>{error}</ErrorText>
        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>Save password</button>
      </form>
    </div>
  );
}
