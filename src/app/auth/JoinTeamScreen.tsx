// Join a team with an invitation.
import { useAppStore } from '../../stores/appStore';
import { passwordProblem, PASSWORD_HINT } from '../../utils/passwordRule';
import { OtpInput } from '../../components/OtpInput';
import { Key, User, Mail, Phone } from 'lucide-react';
import PasswordInput from '../../components/shared/PasswordInput';
import type { AuthFlow } from './useAuthFlow';

/** Join a team with an invitation code or link, then choose a password. */
export function JoinTeamScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { businesses, currentUser, verifyInvitation, acceptInvitation } = useAppStore();
  const {
    setAuthViewTab,
    setRegPassword,
    setVerifyEmail,
    setAuthTermsOpen,
    inviteTokenInput,
    setInviteTokenInput,
    inviteName,
    setInviteName,
    inviteEmail,
    setInviteEmail,
    invitePhone,
    setInvitePhone,
    invitePassword,
    setInvitePassword,
    inviteConfirmPassword,
    setInviteConfirmPassword,
    inviteVerified,
    setInviteVerified,
    validatedInvite,
    setValidatedInvite,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  return (
    <div className="space-y-4 text-xs animate-fade-in">
      {currentUser && (
        <button
          type="button"
          onClick={() => {
            setAuthError('');
            setAuthSuccess('');
            setAuthViewTab('start');
          }}
          className="text-[11px] text-slate-500 hover:text-slate-800 font-semibold"
        >
          Back
        </button>
      )}
      <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-1">
        <h4 className="text-[10.5px] font-semibold text-amber-600 flex items-center gap-1.5">
          <Key size={12} /> Join with an invitation code
        </h4>
        <p className="text-[11px] text-slate-500 leading-normal">
          Enter the invitation code the owner or manager sent you.
        </p>
      </div>

      {!inviteVerified ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            let code = inviteTokenInput.trim().toUpperCase();
            if (code.startsWith('INV-')) {
              code = code.slice(4);
            }
            if (code.length !== 6) {
              setAuthError(
                'The invitation code has 6 letters and numbers.',
              );
              return;
            }
            setAuthLoading(true);
            setAuthError('');
            setAuthSuccess('');
            const res = await verifyInvitation(code);
            setAuthLoading(false);
            if (res.success && res.invitation) {
              setValidatedInvite(res.invitation);
              setInviteVerified(true);
              setInviteName(res.invitation.name);
              setInviteEmail(res.invitation.email);
              setInvitePhone(res.invitation.phone || '');
              setInviteTokenInput(code);
              setAuthSuccess(
                `You're invited as ${res.invitation.role}. Fill in your details to join.`,
              );
            } else {
              setAuthError(
                res.error || 'That invitation code is not valid.',
              );
            }
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-bold block text-center mb-2">
              Enter 6-Digit Invitation Code *
            </label>
            <div className="flex justify-center py-2">
              <OtpInput
                length={6}
                alphanumeric={true}
                value={
                  inviteTokenInput
                    .toUpperCase()
                    .startsWith('INV-')
                    ? inviteTokenInput.slice(4)
                    : inviteTokenInput
                }
                onChange={(val) => setInviteTokenInput(val)}
                disabled={authLoading}
                onComplete={async (code) => {
                  const cleanCode = code.toUpperCase();
                  setAuthLoading(true);
                  setAuthError('');
                  setAuthSuccess('');
                  const res = await verifyInvitation(
                    cleanCode,
                  );
                  setAuthLoading(false);
                  if (res.success && res.invitation) {
                    setValidatedInvite(res.invitation);
                    setInviteVerified(true);
                    setInviteName(res.invitation.name);
                    setInviteEmail(res.invitation.email);
                    setInvitePhone(
                      res.invitation.phone || '',
                    );
                    setInviteTokenInput(cleanCode);
                    setAuthSuccess(
                      `You're invited as ${res.invitation.role}. Fill in your details to join.`,
                    );
                  } else {
                    setAuthError(
                      res.error ||
                        'That invitation code is not valid.',
                    );
                  }
                }}
              />
            </div>
            <span className="text-[11px] text-slate-500 block text-center mt-1">
              6 letters and numbers, e.g. A1B2C3
            </span>
          </div>

          <button
            type="submit"
            disabled={
              authLoading ||
              (inviteTokenInput
                .toUpperCase()
                .startsWith('INV-')
                ? inviteTokenInput.length !== 10
                : inviteTokenInput.length !== 6)
            }
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition cursor-pointer"
          >
            {authLoading
              ? 'Validating Token...'
              : 'Verify Invitation Credentials'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              !inviteEmail.trim() ||
              !inviteName.trim() ||
              !invitePhone.trim() ||
              !invitePassword ||
              !inviteConfirmPassword
            ) {
              setAuthError('All credentials are required.');
              return;
            }
            if (
              inviteEmail.trim().toLowerCase() !==
              validatedInvite.email.toLowerCase()
            ) {
              setAuthError(
                'Use the email address the invitation was sent to.',
              );
              return;
            }
            const invitePasswordProblem = passwordProblem(invitePassword);
            if (invitePasswordProblem) {
              setAuthError(invitePasswordProblem);
              return;
            }
            if (invitePassword !== inviteConfirmPassword) {
              setAuthError('Passwords do not match.');
              return;
            }
            setAuthLoading(true);
            setAuthError('');
            setAuthSuccess('');
            setRegPassword(invitePassword);
            setVerifyEmail(inviteEmail);
            const res = await acceptInvitation(
              inviteTokenInput,
              invitePassword,
              inviteName,
              invitePhone,
            );
            setAuthLoading(false);
            if (res.success) {
              setInviteVerified(false);
              setValidatedInvite(null);
              setInviteTokenInput('');
              setInvitePassword('');
              setInviteConfirmPassword('');
              if (!res.joined) {
                setAuthViewTab('verify');
                setAuthSuccess(
                  `Code accepted. Enter the 6-digit code sent to ${inviteEmail} to join the team.`,
                );
              }
            } else {
              if (res.requiresLogin) {
                // Existing account: they retype its password on this form.
                setAuthError(res.error ?? 'Sign in with your existing password.');
                setInvitePassword('');
                setInviteConfirmPassword('');
              } else {
                setAuthError(
                  res.error || 'Failed to accept invitation.',
                );
              }
            }
          }}
          className="space-y-4"
        >
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1 font-sans">
            <span className="text-[11px] font-semibold text-amber-600">
              You are joining
            </span>
            <h5 className="text-[11px] font-bold text-slate-800">
              {validatedInvite.businessName ||
                businesses.find(
                  (b) => b.id === validatedInvite.businessId,
                )?.name ||
                "the business"}
            </h5>
            <span className="text-[11px] font-semibold text-slate-500 bg-white px-1.5 py-0.5 rounded inline-block mt-1">
              As: {validatedInvite.role}
            </span>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-bold block">
              Your email (the one invited) *
            </label>
            <div className="relative">
              <input
                type="email"
                placeholder="Enter your invited email address"
                value={inviteEmail}
                onChange={(e) =>
                  setInviteEmail(e.target.value)
                }
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
              Full Name *
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Confirm your name"
                value={inviteName}
                onChange={(e) =>
                  setInviteName(e.target.value)
                }
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
              Phone Number *
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Confirm your phone"
                value={invitePhone}
                onChange={(e) =>
                  setInvitePhone(e.target.value)
                }
                className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
              />
              <Phone
                size={13}
                className="absolute left-3 top-3.5 text-slate-500"
              />
            </div>
          </div>

          <PasswordInput label="Secure Password" placeholder={PASSWORD_HINT} value={invitePassword} onChange={setInvitePassword} />

          <PasswordInput label="Confirm Password" placeholder="Re-enter password" value={inviteConfirmPassword} onChange={setInviteConfirmPassword} />

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => {
                setInviteVerified(false);
                setValidatedInvite(null);
                setAuthError('');
                setAuthSuccess('');
              }}
              className="flex-1 py-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold rounded-xl transition"
            >
              Check another code
            </button>
            <button
              type="submit"
              disabled={authLoading}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-slate-950 font-semibold rounded-xl transition"
            >
              {authLoading ? 'Joining...' : 'Accept & Join'}
            </button>
          </div>
          <p className="text-center text-[10px] text-slate-500 leading-normal">
            By joining you agree to the{' '}
            <button
              type="button"
              onClick={() => setAuthTermsOpen(true)}
              className="text-amber-600 hover:text-amber-700 font-semibold underline underline-offset-2 cursor-pointer bg-transparent border-none p-0"
            >
              Terms of Use
            </button>
            .
          </p>
        </form>
      )}
    </div>
  );
}
