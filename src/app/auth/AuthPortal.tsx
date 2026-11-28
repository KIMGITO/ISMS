// Sign-in and onboarding screens (always light): sign in, create account, verify email,
// set up a business, join a team, reset password, and the branch chooser.
import { useAppStore } from '../../stores/appStore';
import { setConsoleOpen } from '../../utils/platformConsole';
import { ShieldCheck, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { TermsDialog } from '../../components/legal/TermsDialog';
import StartScreen from '../../components/signup/StartScreen';
import type { AuthFlow } from './useAuthFlow';
import { BranchChooser } from './BranchChooser';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';
import { VerifyEmailScreen } from './VerifyEmailScreen';
import { CreateBusinessScreen } from './CreateBusinessScreen';
import { JoinTeamScreen } from './JoinTeamScreen';
import { ForgotPasswordScreen, VerifyResetCodeScreen, ResetPasswordScreen } from './PasswordResetScreens';

export function AuthPortal({
  auth,
  showBranchChooser,
  companyNames,
  isPlatformAdmin,
  onOpenBranchChooser,
  onCloseBranchChooser,
}: {
  auth: AuthFlow;
  /** Someone in more than one branch picks one before any screen opens. */
  showBranchChooser: boolean;
  /** Company names for the chooser's headings, by tenant id. */
  companyNames: Record<string, string>;
  isPlatformAdmin: boolean;
  onOpenBranchChooser: () => void;
  onCloseBranchChooser: () => void;
}) {
  const { currentUser, canCreateBusiness, logout } = useAppStore();
  const {
    authViewTab,
    setAuthViewTab,
    setAdminPlanCode,
    authTermsOpen,
    setAuthTermsOpen,
    setInviteEmail,
    authError,
    setAuthError,
    authSuccess,
    setAuthSuccess,
  } = auth;
  return (
    <motion.div
      key="auth-portal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 min-h-0 flex flex-col items-center px-4 md:px-8 pt-[calc(1rem+var(--inset-top))] pb-[calc(1rem+var(--inset-bottom))] md:pt-[calc(2rem+var(--inset-top))] md:pb-[calc(2rem+var(--inset-bottom))] bg-slate-100 text-slate-900 overflow-y-auto select-none relative"
    >

      <div className={`w-full ${authViewTab === 'start' || authViewTab === 'no-business' ? 'max-w-3xl' : 'max-w-lg'} bg-white border border-slate-200 rounded-3xl shadow-sm p-6 md:p-8 space-y-6 animate-fade-in relative`}>
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-white border border-amber-500/30 rounded-2xl flex items-center justify-center overflow-hidden">
            <img src="/denso.svg" alt="Denso" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold font-display tracking-tight text-amber-600">
            Denso
          </h1>
          <p className="text-[10.5px] text-slate-500 font-bold">
            Sales, stock and money for your shop
          </p>
        </div>

        {/* WORKSPACE SWITCHER OVERLAY */}
        {showBranchChooser && currentUser ? (
          <BranchChooser
            currentUser={currentUser}
            companyNames={companyNames}
            isPlatformAdmin={isPlatformAdmin}
            onCloseBranchChooser={onCloseBranchChooser}
          />
        ) : (
          <>
            {/* Error & Success Alerts */}
            {authError && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-600 rounded-2xl text-[11px] leading-relaxed font-semibold flex items-start gap-2 animate-fade-in">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            {authSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 rounded-2xl text-[11px] leading-relaxed font-semibold flex items-start gap-2 animate-fade-in">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span>{authSuccess}</span>
              </div>
            )}

            {/* Navigation Tabs (Only shown if owner exists and not in verifying or business creation steps) */}
            {!currentUser &&
              authViewTab !== 'verify' &&
              authViewTab !== 'create-biz' &&
              authViewTab !== 'no-business' &&
              authViewTab !== 'start' && (
                <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthViewTab('login');
                      setAuthError('');
                      setAuthSuccess('');
                    }}
                    className={`py-2 text-[10px] font-semibold rounded-xl transition ${
                      authViewTab === 'login'
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthViewTab('register');
                      setAuthError('');
                      setAuthSuccess('');
                    }}
                    className={`py-2 text-[10px] font-semibold rounded-xl transition ${
                      authViewTab === 'register'
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    Create account
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthViewTab('accept-invite');
                      setAuthError('');
                      setAuthSuccess('');
                    }}
                    className={`py-2 text-[10px] font-semibold rounded-xl transition ${
                      authViewTab === 'accept-invite'
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    Join Team
                  </button>
                </div>
              )}

            {/* TAB CONTENT: LOGIN */}
            {authViewTab === 'login' && <LoginScreen auth={auth} onOpenBranchChooser={onOpenBranchChooser} />}

            {/* TAB CONTENT: OWNER ONBOARDING (REGISTER) */}
            {authViewTab === 'register' && <RegisterScreen auth={auth} />}

            {/* TAB CONTENT: OWNER ONBOARDING (STAGE 2: EMAIL VERIFICATION PENDING) */}
            {authViewTab === 'verify' && <VerifyEmailScreen auth={auth} />}

            {/* TAB CONTENT: OWNER ONBOARDING (STAGE 3: CREATE BUSINESS) */}
            {authViewTab === 'create-biz' && canCreateBusiness && <CreateBusinessScreen auth={auth} />}

            {/* TAB CONTENT: JOIN TEAM (ACCEPT INVITATION) */}
            {authViewTab === 'accept-invite' && <JoinTeamScreen auth={auth} />}

            {/* TAB CONTENT: FORGOT PASSWORD */}
            {authViewTab === 'forgot-password' && <ForgotPasswordScreen auth={auth} />}

            {/* TAB CONTENT: VERIFY RESET CODE */}
            {authViewTab === 'verify-reset-code' && <VerifyResetCodeScreen auth={auth} />}

            {/* TAB CONTENT: RESET PASSWORD */}
            {authViewTab === 'reset-password' && <ResetPasswordScreen auth={auth} />}

            {/* TAB CONTENT: SESSION EXPIRED */}
            {authViewTab === 'session-expired' && (
              <div className="space-y-4 text-xs animate-fade-in text-center py-4">
                <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-center justify-center text-red-600 animate-bounce">
                  <Clock size={24} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-red-600">
                    Session Expired
                  </h3>
                  <p className="text-[10.5px] text-slate-500 leading-normal">
                    You were signed out. Please sign in again.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAuthViewTab('login');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl transition mt-2 cursor-pointer"
                >
                  Return to Login
                </button>
              </div>
            )}

            {/* TAB CONTENT: SIGNED IN BUT NOT IN ANY BUSINESS: start one or join one */}
            {(authViewTab === 'start' || authViewTab === 'no-business') && currentUser && (
              <div className="light-scope animate-fade-in">
                <StartScreen
                  onCreateBusiness={(planCode) => {
                    setAuthError('');
                    setAuthSuccess('');
                    setAdminPlanCode(planCode);
                    setAuthViewTab('create-biz');
                  }}
                  onEnterInviteCode={() => {
                    setInviteEmail(currentUser.email);
                    setAuthError('');
                    setAuthSuccess('');
                    setAuthViewTab('accept-invite');
                  }}
                  onSignOut={() => logout()}
                  onOpenConsole={isPlatformAdmin ? () => setConsoleOpen(true) : undefined}
                />
              </div>
            )}

            {/* TAB CONTENT: UNAUTHORIZED */}
            {authViewTab === 'unauthorized' && (
              <div className="space-y-4 text-xs animate-fade-in text-center py-4">
                <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-center justify-center text-red-600">
                  <ShieldCheck size={24} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold text-red-600">
                    No access
                  </h3>
                  <p className="text-[10.5px] text-slate-500 leading-normal">
                    Your account is not allowed to open this business.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setAuthViewTab('login');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl transition mt-2 cursor-pointer"
                >
                  Return to Login / Sign Out
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <TermsDialog open={authTermsOpen} onClose={() => setAuthTermsOpen(false)} />
    </motion.div>
  );
}
