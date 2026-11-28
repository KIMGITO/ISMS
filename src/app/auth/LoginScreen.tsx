// Sign-in screen.
import { useAppStore } from '../../stores/appStore';
import { useAuthStore } from '../../stores/authStore';
import { Mail } from 'lucide-react';
import { AuthOtpService } from '../../services/authOtpService';
import PasswordInput from '../../components/shared/PasswordInput';
import type { AuthFlow } from './useAuthFlow';

/** Sign in with email or phone and password. */
export function LoginScreen({
  auth,
  onOpenBranchChooser,
}: {
  auth: AuthFlow;
  onOpenBranchChooser: () => void;
}) {
  const { loginOnline } = useAppStore();
  const {
    setAuthViewTab,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    setVerifyEmail,
    setForgotEmail,
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
        if (!loginEmail.trim() || !loginPassword) {
          setAuthError(
            'Email/phone and password are required.',
          );
          return;
        }
        setAuthLoading(true);
        setAuthError('');
        setAuthSuccess('');
        const res = await loginOnline(
          loginEmail,
          loginPassword,
        );
        setAuthLoading(false);
        if (res.success) {
          const current = useAuthStore.getState().currentUser;
          const currentMems = useAuthStore
            .getState()
            .memberships.filter(
              (m) =>
                m.userId === current?.id &&
                m.status === 'Active',
            );
          if (currentMems.length > 1) {
            onOpenBranchChooser();
          }
        } else {
          if (res.emailConfirmRequired) {
            setVerifyEmail(loginEmail);
            setAuthViewTab('verify');
            setAuthSuccess(
              'Your email is not confirmed yet. Enter the code we sent you.',
            );

            // Attempt automatic resend of confirmation OTP
            try {
              const otpRes = await AuthOtpService.sendSignupCode(
                loginEmail.trim(),
                loginEmail.split('@')[0],
              );
              if (!otpRes.success) throw new Error(otpRes.error);
              setAuthSuccess(
                `Your email is not confirmed yet. We sent a new code to ${loginEmail}.`,
              );
            } catch (err: any) {
              console.error('Auto OTP send failed:', err);
            }
          } else {
            setAuthError(res.error || 'Failed to log in.');
          }
        }
      }}
      className="space-y-4 text-xs"
    >
      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 font-bold block">
          Email Address *
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="e.g. owner@yourshop.co.ke"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
          />
          <Mail
            size={13}
            className="absolute left-3 top-3.5 text-slate-500"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-end items-center">

          <button
            type="button"
            onClick={() => {
              setAuthError('');
              setAuthSuccess('');
              setForgotEmail(loginEmail);
              setAuthViewTab('forgot-password');
            }}
            className="text-[10px] text-amber-600 hover:text-amber-700 font-bold transition cursor-pointer bg-transparent border-none outline-none"
          >
            Forgot Password?
          </button>
        </div>
      <PasswordInput label="Secure Password" placeholder='••••••••' value={loginPassword} onChange={setLoginPassword} />


      </div>

      <button
        type="submit"
        disabled={authLoading}
        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer mt-2"
      >
        {authLoading
          ? 'Authenticating Session...'
          : 'Secure Login Session'}
      </button>

      <p className="text-center text-[10px] text-slate-500 leading-normal">
        By signing in you agree to the{' '}
        <button
          type="button"
          onClick={() => setAuthTermsOpen(true)}
          className="text-amber-600 hover:text-amber-700 font-semibold underline underline-offset-2 cursor-pointer bg-transparent border-none p-0"
        >
          Terms of Use
        </button>
        .
      </p>

      <div className="text-center mt-3 pt-1 border-t border-slate-200">
        <button
          type="button"
          onClick={() => {
            setAuthError('');
            setAuthSuccess('');
            setVerifyEmail(loginEmail);
            setAuthViewTab('verify');
          }}
          className="text-[10px] text-amber-600 hover:text-amber-700 font-bold transition cursor-pointer bg-transparent border-none outline-none"
        >
          Have an unverified account? Verify here
        </button>
      </div>
    </form>
  );
}
