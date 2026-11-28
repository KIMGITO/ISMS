// Email verification step after creating an account.
import { useAppStore } from '../../stores/appStore';
import { OtpInput } from '../../components/OtpInput';
import { Edit, Mail } from 'lucide-react';
import { AuthOtpService } from '../../services/authOtpService';
import { toUserMessage } from '../../utils/userError';
import type { AuthFlow } from './useAuthFlow';

/** Enter the 6-digit code sent to the new account's email; resend or change the email. */
export function VerifyEmailScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { currentUser, logout, updateEmailDuringVerification } = useAppStore();
  const {
    setAuthViewTab,
    verifyEmail,
    setVerifyEmail,
    verifyCode,
    setVerifyCode,
    verifyCountdown,
    setVerifyCountdown,
    isResending,
    isEditingEmail,
    setIsEditingEmail,
    newEmailInput,
    setNewEmailInput,
    handleResendCode,
    handleVerifyOtpSubmit,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  return (
    <div className="space-y-5 text-xs animate-fade-in text-center">
      <div className="py-4 flex justify-center">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-600 ">
          <Mail size={24} />
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-amber-600">
          Confirm Your Email
        </h3>

        {!isEditingEmail ? (
          <div className="space-y-1.5">
            <p className="text-[10.5px] text-slate-700 leading-relaxed">
              We've sent a 6-digit verification code to:
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="font-bold text-slate-800">
                {verifyEmail || '(no email set)'}
              </span>
              <button
                onClick={() => {
                  setNewEmailInput(verifyEmail);
                  setIsEditingEmail(true);
                  setAuthError('');
                  setAuthSuccess('');
                }}
                className="text-amber-600 hover:text-amber-700 p-0.5 transition cursor-pointer"
                title="Edit Email"
              >
                <Edit size={12} />
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newEmailInput.trim()) {
                setAuthError(
                  'Email address cannot be empty.',
                );
                return;
              }
              setAuthLoading(true);
              setAuthError('');
              setAuthSuccess('');

              if (currentUser) {
                const res =
                  await updateEmailDuringVerification(
                    newEmailInput,
                  );
                setAuthLoading(false);
                if (res.success) {
                  setVerifyEmail(newEmailInput.trim());
                  setIsEditingEmail(false);
                  setVerifyCountdown(60);
                  setVerifyCode('');
                  setAuthSuccess(
                    `Email changed. Code sent to ${newEmailInput.trim()}.`,
                  );
                } else {
                  setAuthError(
                    res.error || 'Failed to update email.',
                  );
                }
              } else {
                // Guest mode email change - update local state and send new verification code via RPC
                try {
                  const otpRes = await AuthOtpService.sendSignupCode(
                    newEmailInput.trim(),
                    newEmailInput.split('@')[0] || 'User',
                  );
                  if (!otpRes.success) {
                    setAuthError(otpRes.error || 'Failed to send verification code.');
                    return;
                  }

                  setVerifyEmail(newEmailInput.trim());
                  setIsEditingEmail(false);
                  setVerifyCountdown(60);
                  setVerifyCode('');
                  setAuthSuccess(
                    `Code sent to ${newEmailInput.trim()}.`,
                  );
                } catch (err: any) {
                  console.error(
                    'Guest OTP send failed:',
                    err,
                  );
                  setAuthError(
                    toUserMessage(err, 'Could not send the code. Try again in a minute.'),
                  );
                } finally {
                  setAuthLoading(false);
                }
              }
            }}
            className="w-full max-w-sm mx-auto space-y-3 bg-slate-50 p-3.5 border border-slate-200 rounded-2xl animate-fade-in"
          >
            <div className="text-left space-y-1">
              <label className="text-[11px] text-slate-500 font-bold block">
                Update Email Address
              </label>
              <input
                type="email"
                placeholder="e.g. you@example.com"
                value={newEmailInput}
                onChange={(e) =>
                  setNewEmailInput(e.target.value)
                }
                className="w-full bg-white text-slate-900 px-3 py-2 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 text-[10px]">
              <button
                type="submit"
                disabled={authLoading}
                className="flex-1 py-2 bg-amber-500 text-slate-950 font-semibold rounded-lg transition hover:bg-amber-600 disabled:opacity-50 cursor-pointer"
              >
                {authLoading ? 'Saving...' : 'Save & Resend'}
              </button>
              <button
                type="button"
                onClick={() => setIsEditingEmail(false)}
                className="px-3 py-2 bg-slate-100 text-slate-700 font-bold rounded-lg transition hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {!isEditingEmail && (
        <>
          <div className="py-3 flex justify-center">
            <OtpInput
              length={6}
              value={verifyCode}
              onChange={setVerifyCode}
              disabled={authLoading}
              onComplete={(code) =>
                handleVerifyOtpSubmit(code)
              }
            />
          </div>

          <div className="flex flex-col gap-2.5">
            {verifyCountdown > 0 ? (
              <span className="text-[10px] text-slate-500">
                Can Resend code in{' '}
                <strong className="text-amber-600">
                  {verifyCountdown}s
                </strong>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isResending}
                className="text-[10.5px] text-amber-600 hover:text-amber-700 font-bold transition cursor-pointer"
              >
                {isResending
                  ? 'Resending Code...'
                  : 'Resend Code'}
              </button>
            )}

            <button
              type="button"
              onClick={() => handleVerifyOtpSubmit()}
              disabled={
                authLoading || verifyCode.length !== 6
              }
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition cursor-pointer shadow-lg mt-2"
            >
              {authLoading ? 'Verifying...' : 'Verify Code'}
            </button>

            {!currentUser ? (
              <div className="flex justify-center gap-4 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthViewTab('login');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                  className="text-[10px] text-slate-500 hover:text-slate-700 transition cursor-pointer font-bold bg-transparent border-none outline-none"
                >
                  Return to Login
                </button>

              </div>
            ) : (
              <button
                type="button"
                onClick={() => logout()}
                className="text-[10px] text-red-600 hover:text-red-700 transition cursor-pointer mt-1 font-bold bg-transparent border-none outline-none"
              >
                Cancel & Sign Out
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
