// Forgot password: ask for a code, enter it, choose the new password.
import { useAppStore } from '../../stores/appStore';
import { OtpInput } from '../../components/OtpInput';
import { Lock, ShieldCheck, Key, Mail } from 'lucide-react';
import PasswordInput from '../../components/shared/PasswordInput';
import type { AuthFlow } from './useAuthFlow';

/** Ask for a reset code by email. */
export function ForgotPasswordScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { sendPasswordResetOtp } = useAppStore();
  const {
    setAuthViewTab,
    forgotEmail,
    setForgotEmail,
    setResetCountdown,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!forgotEmail.trim()) {
          setAuthError('Email address is required.');
          return;
        }
        setAuthLoading(true);
        setAuthError('');
        setAuthSuccess('');
        const res = await sendPasswordResetOtp(forgotEmail);
        setAuthLoading(false);
        if (res.success) {
          setAuthViewTab('verify-reset-code');
          setResetCountdown(60);
          setAuthSuccess(
            `We sent a 6-digit code to ${forgotEmail}.`,
          );
        } else {
          setAuthError(
            res.error ||
              'Failed to request password reset code.',
          );
        }
      }}
      className="space-y-4 text-xs animate-fade-in"
    >
      <div className="text-center space-y-1">
        <h3 className="text-xs font-semibold text-amber-600 flex items-center justify-center gap-1.5">
          <Key size={16} /> Recover Password
        </h3>
        <p className="text-[10.5px] text-slate-500">
          We'll email you a 6-digit code.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-slate-500 font-bold block">
          Email Address *
        </label>
        <div className="relative">
          <input
            type="email"
            placeholder="e.g. owner@yourshop.co.ke"
            value={forgotEmail}
            onChange={(e) => setForgotEmail(e.target.value)}
            className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
          />
          <Mail
            size={13}
            className="absolute left-3 top-3.5 text-slate-500"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={authLoading}
        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-lg mt-2"
      >
        {authLoading
          ? 'Sending Recovery Code...'
          : 'Send Recovery Code'}
      </button>

      <button
        type="button"
        onClick={() => {
          setAuthViewTab('login');
          setAuthError('');
          setAuthSuccess('');
        }}
        className="w-full py-2.5 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-900 font-bold rounded-xl text-xs transition tracking-wide text-center"
      >
        Return to Login
      </button>
    </form>
  );
}

/** Enter the emailed reset code. */
export function VerifyResetCodeScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { sendPasswordResetOtp, verifyPasswordResetOtp } = useAppStore();
  const {
    setAuthViewTab,
    forgotEmail,
    resetOtpCode,
    setResetOtpCode,
    resetCountdown,
    setResetCountdown,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  return (
    <div className="space-y-5 text-xs animate-fade-in text-center">
      <div className="py-4 flex justify-center">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-600 ">
          <ShieldCheck size={24} />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-amber-600">
          Verify Recovery Code
        </h3>
        <p className="text-[10.5px] text-slate-700 leading-relaxed">
          We've sent a 6-digit recovery code to{' '}
          <strong>{forgotEmail}</strong>. Enter it below to
          verify:
        </p>
      </div>

      <div className="py-3 flex justify-center">
        <OtpInput
          length={6}
          value={resetOtpCode}
          onChange={setResetOtpCode}
          disabled={authLoading}
          onComplete={async (code) => {
            setAuthLoading(true);
            setAuthError('');
            setAuthSuccess('');
            const res = await verifyPasswordResetOtp(
              forgotEmail,
              code,
            );
            setAuthLoading(false);
            if (res.success) {
              setAuthViewTab('reset-password');
              setAuthSuccess(
                'Code verified! Set your new secure password.',
              );
            } else {
              setAuthError(
                res.error ||
                  'Verification failed. Check the code.',
              );
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        {resetCountdown > 0 ? (
          <span className="text-[10px] text-slate-500">
            Can Resend code in{' '}
            <strong className="text-amber-600">
              {resetCountdown}s
            </strong>
          </span>
        ) : (
          <button
            type="button"
            onClick={async () => {
              setAuthLoading(true);
              setAuthError('');
              setAuthSuccess('');
              const res = await sendPasswordResetOtp(
                forgotEmail,
              );
              setAuthLoading(false);
              if (res.success) {
                setResetCountdown(60);
                setResetOtpCode('');
                setAuthSuccess(
                  `New code sent to ${forgotEmail}.`,
                );
              } else {
                setAuthError(
                  res.error || 'Failed to resend code.',
                );
              }
            }}
            className="text-[10.5px] text-amber-600 hover:text-amber-700 font-bold transition cursor-pointer"
          >
            Resend Code
          </button>
        )}

        <button
          type="button"
          onClick={async () => {
            if (resetOtpCode.length !== 6) {
              setAuthError(
                'Please enter a valid 6-digit code.',
              );
              return;
            }
            setAuthLoading(true);
            setAuthError('');
            setAuthSuccess('');
            const res = await verifyPasswordResetOtp(
              forgotEmail,
              resetOtpCode,
            );
            setAuthLoading(false);
            if (res.success) {
              setAuthViewTab('reset-password');
              setAuthSuccess(
                'Code verified! Set your new secure password.',
              );
            } else {
              setAuthError(
                res.error ||
                  'Verification failed. Check the code.',
              );
            }
          }}
          disabled={authLoading || resetOtpCode.length !== 6}
          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition cursor-pointer shadow-lg mt-2"
        >
          {authLoading ? 'Verifying...' : 'Verify Code'}
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthViewTab('login');
            setAuthError('');
            setAuthSuccess('');
          }}
          className="text-[10px] text-slate-500 hover:text-slate-700 transition cursor-pointer mt-1"
        >
          Return to Login
        </button>
      </div>
    </div>
  );
}

/** Choose the new password (with its strength checks). */
export function ResetPasswordScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { logout, updatePassword } = useAppStore();
  const {
    setAuthViewTab,
    forgotEmail,
    resetOtpCode,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  const hasLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);

  const strengthScore = [
    hasLength,
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
  ].filter(Boolean).length;

  let strengthColor = 'bg-red-500';
  let strengthText = 'Very Weak';
  if (strengthScore === 2) {
    strengthColor = 'bg-orange-500';
    strengthText = 'Weak';
  } else if (strengthScore === 3) {
    strengthColor = 'bg-yellow-500';
    strengthText = 'Fair';
  } else if (strengthScore === 4) {
    strengthColor = 'bg-lime-500';
    strengthText = 'Strong';
  } else if (strengthScore === 5) {
    strengthColor = 'bg-emerald-500';
    strengthText = 'Very Strong';
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
          setAuthError('Passwords do not match.');
          return;
        }
        if (strengthScore < 3) {
          setAuthError(
            'Choose a password that meets the requirements below.',
          );
          return;
        }
        setAuthLoading(true);
        setAuthError('');
        setAuthSuccess('');
        const res = await updatePassword(newPassword, {
          email: forgotEmail,
          code: resetOtpCode,
        });
        setAuthLoading(false);
        if (res.success) {
          setAuthSuccess(
            'Password changed. Sign in with your new password.',
          );
          // Sign out the recovery session
          await logout();
          setTimeout(() => {
            setAuthViewTab('login');
            setAuthSuccess('');
          }, 3000);
        } else {
          setAuthError(
            res.error || 'Failed to update password.',
          );
        }
      }}
      className="space-y-4 text-xs animate-fade-in"
    >
      <div className="text-center space-y-1">
        <h3 className="text-xs font-semibold text-amber-600 flex items-center justify-center gap-1.5">
          <Lock size={16} /> Choose New Password
        </h3>
        <p className="text-[10.5px] text-slate-500">
          Choose a strong password
          credentials for your profile.
        </p>
      </div>

      <PasswordInput label="New Password" placeholder="Min. 8 characters" value={newPassword} onChange={setNewPassword} />

      {/* PASSWORD STRENGTH VISUAL INDICATOR */}
      {newPassword && (
        <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl text-left">
          <div className="flex justify-between items-center text-[10px]">
            <span className="text-slate-500 font-semibold">
              Password Strength:
            </span>
            <span
              className={`font-semibold ${
                strengthScore >= 3
                  ? 'text-emerald-400'
                  : 'text-red-600'
              }`}
            >
              {strengthText}
            </span>
          </div>
          <div className="w-full h-1.5 bg-white rounded-full overflow-hidden">
            <div
              className={`h-full ${strengthColor} transition-all duration-300`}
              style={{
                width: `${(strengthScore / 5) * 100}%`,
              }}
            />
          </div>

          <ul className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500 font-medium">
            <li className="flex items-center gap-1">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  hasLength
                    ? 'bg-emerald-500'
                    : 'bg-slate-200'
                }`}
              />
              <span>At least 8 chars</span>
            </li>
            <li className="flex items-center gap-1">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  hasUpper
                    ? 'bg-emerald-500'
                    : 'bg-slate-200'
                }`}
              />
              <span>Uppercase letter</span>
            </li>
            <li className="flex items-center gap-1">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  hasLower
                    ? 'bg-emerald-500'
                    : 'bg-slate-200'
                }`}
              />
              <span>Lowercase letter</span>
            </li>
            <li className="flex items-center gap-1">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  hasNumber
                    ? 'bg-emerald-500'
                    : 'bg-slate-200'
                }`}
              />
              <span>A number</span>
            </li>
            <li className="flex items-center gap-2 col-span-2">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  hasSpecial
                    ? 'bg-emerald-500'
                    : 'bg-slate-200'
                }`}
              />
              <span>Special character (e.g. !@#$)</span>
            </li>
          </ul>
        </div>
      )}

      <PasswordInput label="Confirm New Password" placeholder="Re-enter password" value={confirmPassword} onChange={setConfirmPassword} />

      <button
        type="submit"
        disabled={authLoading || strengthScore < 3}
        className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-lg mt-2"
      >
        {authLoading
          ? 'Updating Password...'
          : 'Update Password Credentials'}
      </button>
    </form>
  );
}
