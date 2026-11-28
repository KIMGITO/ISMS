// Sign-in, sign-up, verification, invitations and password reset: every field and step of
// the auth screens (AuthPortal). App calls it once, so typed values survive screen swaps.
import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { AuthOtpService } from '../../services/authOtpService';
import { toUserMessage } from '../../utils/userError';
import { captureWantedPlan } from '../../utils/wantedPlan';
import { JOIN_CODE_KEY } from '../../components/signup/StartScreen';

export type AuthViewTab =
  | 'login'
  | 'register'
  | 'verify'
  | 'create-biz'
  | 'accept-invite'
  | 'forgot-password'
  | 'verify-reset-code'
  | 'reset-password'
  | 'session-expired'
  | 'unauthorized'
  | 'no-business'
  | 'start';

export function useAuthFlow() {
  const { currentUser, memberships, canCreateBusiness, verifyEmailCode, loginOnline, verifyInvitation } =
    useAppStore();

  const [businessType, setBusinessType] = useState('');
  const finalBusinessType = businessType.trim();

  // ==========================================
  // NEW ONLINE AUTH & ONBOARDING STATES
  // ==========================================
  const [authViewTab, setAuthViewTab] = useState<AuthViewTab>(() => (new URLSearchParams(window.location.search).has('plan') ? 'register' : 'login'));
  /** Platform admin only: the plan a new company is created on (no payment). */
  const [adminPlanCode, setAdminPlanCode] = useState<string | undefined>(undefined);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyCountdown, setVerifyCountdown] = useState(60);
  const [isResending, setIsResending] = useState(false);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');

  const [forgotEmail, setForgotEmail] = useState('');
  const [authTermsOpen, setAuthTermsOpen] = useState(false);
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCountdown, setResetCountdown] = useState(0);

  // Recovery code countdown timer
  useEffect(() => {
    let interval: any;
    if (authViewTab === 'verify-reset-code' && resetCountdown > 0) {
      interval = setInterval(() => {
        setResetCountdown((c) => c - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [authViewTab, resetCountdown]);

  // Verification code countdown timer
  useEffect(() => {
    let interval: any;
    if (authViewTab === 'verify' && verifyCountdown > 0) {
      interval = setInterval(() => {
        setVerifyCountdown((c) => c - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [authViewTab, verifyCountdown]);

  // Support manual/automated navigation to specific auth screens via URL parameters and deep links
  useEffect(() => {
    const handleUrlNavigation = () => {
      const params = new URLSearchParams(window.location.search);
      const screenParam = params.get('screen');
      const emailParam = params.get('email');
      const codeParam =
        params.get('code') || params.get('token') || params.get('otp');

      if (screenParam) {
        const validScreens = [
          'login',
          'register',
          'verify',
          'accept-invite',
          'forgot-password',
          'verify-reset-code',
          'reset-password',
          'session-expired',
          'unauthorized',
        ];
        if (validScreens.includes(screenParam)) {
          setAuthViewTab(screenParam as any);
          if (emailParam) {
            if (screenParam === 'verify') setVerifyEmail(emailParam);
            else if (screenParam === 'login') setLoginEmail(emailParam);
            else if (screenParam === 'register') setRegEmail(emailParam);
            else if (
              screenParam === 'forgot-password' ||
              screenParam === 'verify-reset-code'
            )
              setForgotEmail(emailParam);
            else if (screenParam === 'accept-invite')
              setInviteEmail(emailParam);
          }
          if (codeParam) {
            let cleanCode = codeParam.trim().toUpperCase();
            if (cleanCode.startsWith('INV-')) cleanCode = cleanCode.slice(4);
            if (screenParam === 'verify') setVerifyCode(cleanCode);
            else if (screenParam === 'verify-reset-code')
              setResetOtpCode(cleanCode);
            else if (
              screenParam === 'accept-invite' ||
              screenParam === 'register'
            )
              setInviteTokenInput(cleanCode);
          }
        }
      }
    };

    handleUrlNavigation();
    window.addEventListener('popstate', handleUrlNavigation);
    return () => window.removeEventListener('popstate', handleUrlNavigation);
  }, []);

  // Synchronize browser URL query parameter with the active authViewTab
  useEffect(() => {
    if (!currentUser) {
      const url = new URL(window.location.href);
      const currentScreen = url.searchParams.get('screen');
      if (currentScreen !== authViewTab) {
        url.searchParams.set('screen', authViewTab);
        window.history.pushState(null, '', url.pathname + url.search);
      }
    }
  }, [authViewTab, currentUser]);

  // Synchronize authViewTab based on Supabase session and owner status
  useEffect(() => {
    if (currentUser) {
      if (authViewTab === 'reset-password') {
        // Keep user on the reset-password page to complete password update
        return;
      }
      if (!currentUser.isVerified) {
        setVerifyEmail(currentUser.email);
        setAuthViewTab('verify');
      } else {
        const activeMems = memberships.filter(
          (m) => m.userId === currentUser.id && m.status === 'Active',
        );
        // Not in any business yet: the start screen (start one, join one, invitations, requests).
        // The set-up form only while the server says they may create a company.
        if (activeMems.length === 0) {
          const stay =
            authViewTab === 'start' ||
            authViewTab === 'accept-invite' ||
            (authViewTab === 'create-biz' && canCreateBusiness);
          if (!stay) setAuthViewTab('start');
        } else if (authViewTab === 'create-biz' || authViewTab === 'no-business' || authViewTab === 'start') {
          setAuthViewTab('login');
        }
      }
    } else {
      {
        // Prevent redirecting away from other guest auth tabs
        const guestTabs = [
          'login',
          'register',
          'forgot-password',
          'verify-reset-code',
          'reset-password',
          'accept-invite',
          'verify',
          'session-expired',
          'unauthorized',
        ];
        if (!guestTabs.includes(authViewTab)) {
          setAuthViewTab('login');
        }
      }
    }
  }, [currentUser, canCreateBusiness, memberships, authViewTab]);

  const handleResendCode = async () => {
    // Guard: verifyEmail must be set before resending
    if (!verifyEmail?.trim()) {
      setAuthError(
        'Go back and enter your email.',
      );
      return;
    }
    setIsResending(true);
    setAuthError('');
    setAuthSuccess('');
    try {
      // Use regName if available, otherwise fall back to the email prefix as a display name
      const displayName =
        regName?.trim() || verifyEmail.split('@')[0] || 'User';
      const otpRes = await AuthOtpService.sendSignupCode(
        verifyEmail.trim(),
        displayName,
      );
      if (!otpRes.success) {
        setAuthError(otpRes.error || 'Failed to resend verification code.');
        return;
      }

      setVerifyCountdown(60);
      setVerifyCode('');
      setAuthSuccess(
        `New code sent to ${verifyEmail}.`,
      );
    } catch (err: any) {
      console.error('Resend OTP failed:', err);
      setAuthError(toUserMessage(err, 'Could not send a new code. Check your connection and try again.'));
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtpSubmit = async (codeToSubmit?: string) => {
    const code = codeToSubmit || verifyCode;
    if (code.length !== 6) {
      setAuthError('Please enter a valid 6-digit code.');
      return;
    }
    // Guard: verifyEmail must be set
    if (!verifyEmail?.trim()) {
      setAuthError(
        'Go back and enter your email.',
      );
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccess('');

    try {
      const res = await verifyEmailCode(verifyEmail, code);
      if (res.success) {
        setAuthSuccess('Email confirmed. Signing you in…');
        try {
          const loginRes = await loginOnline(verifyEmail, regPassword);
          if (loginRes.success) {
            // Invited people are now in their business and the app opens; the
            // screen effect sends only the system's creator to set up a business.
            setAuthSuccess('');
          } else {
            setAuthViewTab('login');
            setLoginEmail(verifyEmail);
            setAuthSuccess(
              'Email confirmed. Enter your password to sign in.',
            );
          }
        } catch (loginErr: any) {
          console.error('Auto login failed after verification:', loginErr);
          setAuthViewTab('login');
          setLoginEmail(verifyEmail);
          setAuthSuccess('Account verified. Please login manually.');
        }
      } else {
        const errMsg =
          typeof res.error === 'string' && res.error.length > 0
            ? res.error
            : 'Verification failed. Check the code and try again.';
        setAuthError(errMsg);
        setVerifyCode(''); // Clear the code so user can re-enter cleanly
      }
    } catch (err: any) {
      console.error('OTP verification crashed:', err);
      const msg = toUserMessage(err, 'Something went wrong. Please try again.');
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const [bizNameField, setBizNameField] = useState('');
  const [bizCountryField, setBizCountryField] = useState('Kenya');
  const [bizCurrencyField, setBizCurrencyField] = useState('Ksh');

  const [inviteTokenInput, setInviteTokenInput] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('');
  const [inviteVerified, setInviteVerified] = useState(false);
  const [validatedInvite, setValidatedInvite] = useState<any | null>(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  // A join-code link (the QR code in Workers): keep the code until they are signed in; the start
  // screen fills it in.
  useEffect(() => {
    const url = new URL(window.location.href);
    const join = url.searchParams.get('join');
    if (!join) return;
    try {
      sessionStorage.setItem(JOIN_CODE_KEY, join.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8));
    } catch {
      /* they type the code instead */
    }
    url.searchParams.delete('join');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, []);

  // A plan picked on the public plans page (?plan=pro&cycle=monthly): kept until they are
  // signed in; the start screen then opens it.
  useEffect(() => {
    captureWantedPlan();
  }, []);

  // Parse secure email invitation links in the URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token) {
      setAuthViewTab('accept-invite');
      setInviteTokenInput(token);

      const checkInvite = async () => {
        setAuthLoading(true);
        setAuthError('');
        setAuthSuccess('');
        const res = await verifyInvitation(token);
        setAuthLoading(false);
        if (res.success && res.invitation) {
          setValidatedInvite(res.invitation);
          setInviteVerified(true);
          setInviteName(res.invitation.name);
          setInvitePhone(res.invitation.phone);
          setAuthSuccess(
            `You're invited as ${res.invitation.role}. Choose a password to join.`,
          );
        } else {
          setAuthError(
            res.error || 'The invitation link is invalid or has expired.',
          );
        }
      };
      checkInvite();
    }
  }, []);

  return {
    businessType,
    setBusinessType,
    finalBusinessType,
    authViewTab,
    setAuthViewTab,
    adminPlanCode,
    setAdminPlanCode,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    regName,
    setRegName,
    regEmail,
    setRegEmail,
    regPhone,
    setRegPhone,
    regPassword,
    setRegPassword,
    verifyEmail,
    setVerifyEmail,
    verifyCode,
    setVerifyCode,
    verifyCountdown,
    setVerifyCountdown,
    isResending,
    setIsResending,
    isEditingEmail,
    setIsEditingEmail,
    newEmailInput,
    setNewEmailInput,
    forgotEmail,
    setForgotEmail,
    authTermsOpen,
    setAuthTermsOpen,
    resetOtpCode,
    setResetOtpCode,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    resetCountdown,
    setResetCountdown,
    handleResendCode,
    handleVerifyOtpSubmit,
    bizNameField,
    setBizNameField,
    bizCountryField,
    setBizCountryField,
    bizCurrencyField,
    setBizCurrencyField,
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
    authError,
    setAuthError,
    authSuccess,
    setAuthSuccess,
  };
}

export type AuthFlow = ReturnType<typeof useAuthFlow>;
