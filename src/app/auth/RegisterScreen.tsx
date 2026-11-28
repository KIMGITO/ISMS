// Create-account screen (the first step for a new owner).
import { useAppStore } from '../../stores/appStore';
import { passwordProblem, PASSWORD_HINT } from '../../utils/passwordRule';
import { User, Building, Mail, Phone } from 'lucide-react';
import PasswordInput from '../../components/shared/PasswordInput';
import type { AuthFlow } from './useAuthFlow';

/** Create an account (name, email, phone, password); a code is then emailed. */
export function RegisterScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { signUpOwner } = useAppStore();
  const {
    setAuthViewTab,
    regName,
    setRegName,
    regEmail,
    setRegEmail,
    regPhone,
    setRegPhone,
    regPassword,
    setRegPassword,
    setVerifyEmail,
    setAuthTermsOpen,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          !regName.trim() ||
          !regEmail.trim() ||
          !regPhone.trim() ||
          !regPassword
        ) {
          setAuthError(
            'All registration fields are required.',
          );
          return;
        }
        const regPasswordProblem = passwordProblem(regPassword);
        if (regPasswordProblem) {
          setAuthError(regPasswordProblem);
          return;
        }
        setAuthLoading(true);
        setAuthError('');
        setAuthSuccess('');
        const res = await signUpOwner(
          regName,
          regEmail,
          regPhone,
          regPassword,
        );
        setAuthLoading(false);
        if (res.success) {
          setVerifyEmail(regEmail);
          setAuthViewTab('verify');
          setAuthSuccess(
            `Confirmation email sent.`,
          );
        } else {
          setAuthError(
            res.error || 'Failed to create account.',
          );
        }
      }}
      className="space-y-4 text-xs"
    >
      <div className="p-3.5 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-1.5">
        <h4 className="text-[10.5px] font-semibold text-amber-600 flex items-center gap-1.5">
          <Building size={12} /> Your account
        </h4>
        <p className="text-[11px] text-slate-500 leading-normal">
          After you confirm your email you can start your own
          business (free trial or a plan) or join one you work for.
          Invited by email? Use Join team instead.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 font-bold block">
          Full Name *
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="e.g. Jane Wanjiku"
            value={regName}
            onChange={(e) => setRegName(e.target.value)}
            className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
          />
          <User
            size={13}
            className="absolute left-3 top-3.5 text-slate-500"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 font-bold block">
          Email Address *
        </label>
        <div className="relative">
          <input
            type="email"
            placeholder="e.g. owner@yourshop.co.ke"
            value={regEmail}
            onChange={(e) => setRegEmail(e.target.value)}
            className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
          />
          <Mail
            size={13}
            className="absolute left-3 top-3.5 text-slate-500"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 font-bold block">
          Phone Number *
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="e.g. +254712345678"
            value={regPhone}
            onChange={(e) => setRegPhone(e.target.value)}
            className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
          />
          <Phone
            size={13}
            className="absolute left-3 top-3.5 text-slate-500"
          />
        </div>
      </div>

      <PasswordInput
        label="Choose Password"
        value={regPassword}
        onChange={(val) => setRegPassword(val)}
        placeholder={PASSWORD_HINT}
      />

      <button
        type="submit"
        disabled={authLoading}
        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-lg mt-2"
      >
        {authLoading
          ? 'Creating Profile...'
          : 'Create account'}
      </button>

      <p className="text-center text-[10px] text-slate-500 leading-normal">
        By creating an account you agree to the{' '}
        <button
          type="button"
          onClick={() => setAuthTermsOpen(true)}
          className="text-amber-600 hover:text-amber-700 font-semibold underline underline-offset-2 cursor-pointer bg-transparent border-none p-0"
        >
          Terms of Use
        </button>
        .
      </p>

      <p className="text-center text-[11px] text-slate-500">
        Already have an account?{' '}
        <button
          type="button"
          onClick={() => {
            setAuthViewTab('login');
            setAuthError('');
            setAuthSuccess('');
          }}
          className="text-amber-600 hover:text-amber-700 font-semibold cursor-pointer bg-transparent border-none p-0"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}
