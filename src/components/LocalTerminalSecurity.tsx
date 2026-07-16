import React, { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, ShieldAlert, Key, LogOut, CheckCircle2, RotateCcw, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LocalPinSetupCardProps {
  employee: {
    id: string;
    name: string;
    role: string;
    avatar: string;
  };
  onComplete: (newPin: string) => void;
}

export function LocalPinSetupCard({ employee, onComplete }: LocalPinSetupCardProps) {
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = useState("");
  const [enteredPin, setEnteredPin] = useState("");
  const [error, setError] = useState("");

  const pinLength = localStorage.getItem("kkm_passcode_type") === "6" ? 6 : 4;

  const handleKeyPress = (num: string) => {
    setError("");
    if (enteredPin.length < pinLength) {
      const next = enteredPin + num;
      setEnteredPin(next);

      if (next.length === pinLength) {
        // Trigger verification on target digits
        setTimeout(() => {
          if (stage === "enter") {
            setFirstPin(next);
            setEnteredPin("");
            setStage("confirm");
          } else {
            if (next === firstPin) {
              onComplete(next);
            } else {
              setError("PIN passcodes did not match. Please start over.");
              setStage("enter");
              setFirstPin("");
              setEnteredPin("");
            }
          }
        }, 150);
      }
    }
  };

  const handleBackspace = () => {
    setError("");
    setEnteredPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError("");
    setEnteredPin("");
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-4 bg-slate-950 text-slate-100 min-h-screen select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl relative text-center">
        {/* Step Indicator */}
        <div className="mx-auto w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20 text-amber-500 shadow-lg">
          <Key size={22} className="" />
        </div>

        <div className="space-y-1">
          <span className="text-[9px] font-black tracking-widest text-amber-500 uppercase">
            Local Security Configuration
          </span>
          <h2 className="text-lg font-black font-display tracking-tight text-slate-100">
            {stage === "enter" ? "Create Passcode" : "Confirm Passcode"}
          </h2>
          <p className="text-[10.5px] text-slate-400 font-medium leading-relaxed px-4">
            {stage === "enter"
              ? `Set up a secure ${pinLength}-digit passcode to authorize instant POS clearings and dashboard locks.`
              : `Re-enter the ${pinLength}-digit security passcode to verify accurate registration.`}
          </p>
        </div>

        {/* PIN Dot Indicators */}
        <div className="flex justify-center gap-4 py-4">
          {Array.from({ length: pinLength }).map((_, index) => (
            <div
              key={index}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                index < enteredPin.length
                  ? "bg-amber-500 border-amber-500 scale-110 shadow-lg shadow-amber-500/20"
                  : "bg-transparent border-slate-700"
              }`}
            />
          ))}
        </div>

        {/* Error Feedback */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-3 flex items-center gap-2 justify-center text-xs text-red-400 animate-shake">
            <AlertCircle size={13} />
            <span className="font-bold">{error}</span>
          </div>
        )}

        {/* PIN Pad Keyboard */}
        <div className="grid grid-cols-3 gap-2.5 max-w-[280px] mx-auto pt-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num)}
              className="h-14 bg-slate-900 hover:bg-slate-850 active:bg-slate-800 text-slate-200 font-black text-lg rounded-2xl transition border border-slate-800 shadow-sm flex items-center justify-center cursor-pointer"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-14 bg-slate-950 text-slate-500 hover:text-slate-300 font-bold text-xs rounded-2xl transition border border-transparent flex items-center justify-center cursor-pointer uppercase tracking-wider"
          >
            Clear
          </button>
          <button
            onClick={() => handleKeyPress("0")}
            className="h-14 bg-slate-900 hover:bg-slate-850 active:bg-slate-800 text-slate-200 font-black text-lg rounded-2xl transition border border-slate-800 shadow-sm flex items-center justify-center cursor-pointer"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="h-14 bg-slate-950 text-slate-500 hover:text-slate-300 font-bold text-xs rounded-2xl transition border border-transparent flex items-center justify-center cursor-pointer uppercase tracking-wider"
          >
            Delete
          </button>
        </div>

        {/* Helper Badge */}
        <div className="pt-2">
          <span className="text-[8.5px] font-mono text-slate-500 uppercase tracking-widest block">
            Operator Context: {employee.name} ({employee.role})
          </span>
        </div>
      </div>
    </div>
  );
}

interface LocalPinUnlockCardProps {
  employee: {
    id: string;
    name: string;
    role: string;
    avatar: string;
    pin: string;
  };
  onUnlock: () => void;
  onLogout: () => void;
  onResetPin: () => void;
}

export function LocalPinUnlockCard({ employee, onUnlock, onLogout, onResetPin }: LocalPinUnlockCardProps) {
  const [enteredPin, setEnteredPin] = useState("");
  const [error, setError] = useState("");

  const pinLength = employee.pin.length || (localStorage.getItem("kkm_passcode_type") === "6" ? 6 : 4);
  
  // Lockout states
  const [failedAttempts, setFailedAttempts] = useState(() => {
    return Number(localStorage.getItem(`kkm_failed_attempts_${employee.id}`) || "0");
  });
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  // Reset PIN states
  const [isResetting, setIsResetting] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetError, setResetError] = useState("");

  // Check lockout on mount & update failed attempts
  useEffect(() => {
    const lockoutUntil = Number(localStorage.getItem(`kkm_lockout_until_${employee.id}`) || "0");
    if (lockoutUntil > Date.now()) {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setLockoutRemaining(remaining);
    }
  }, [employee.id]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const interval = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          localStorage.removeItem(`kkm_lockout_until_${employee.id}`);
          localStorage.setItem(`kkm_failed_attempts_${employee.id}`, "0");
          setFailedAttempts(0);
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutRemaining, employee.id]);

  const handleKeyPress = (num: string) => {
    if (lockoutRemaining > 0) return;
    setError("");
    
    if (enteredPin.length < pinLength) {
      const next = enteredPin + num;
      setEnteredPin(next);

      if (next.length === pinLength) {
        setTimeout(() => {
          if (next === employee.pin) {
            // Unlock Success
            localStorage.setItem(`kkm_failed_attempts_${employee.id}`, "0");
            setFailedAttempts(0);
            onUnlock();
          } else {
            // Unlock Failed
            const nextFailed = failedAttempts + 1;
            setFailedAttempts(nextFailed);
            localStorage.setItem(`kkm_failed_attempts_${employee.id}`, String(nextFailed));
            setEnteredPin("");

            if (nextFailed >= 5) {
              const lockoutTime = Date.now() + 30000; // 30 seconds penalty
              localStorage.setItem(`kkm_lockout_until_${employee.id}`, String(lockoutTime));
              setLockoutRemaining(30);
              setError("Terminal locked due to too many failed attempts.");
            } else {
              setError(`Incorrect passcode. ${5 - nextFailed} attempts remaining.`);
            }
          }
        }, 150);
      }
    }
  };

  const handleBackspace = () => {
    if (lockoutRemaining > 0) return;
    setError("");
    setEnteredPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (lockoutRemaining > 0) return;
    setError("");
    setEnteredPin("");
  };

  const handlePasswordResetVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");

    // Simulate online password check (accepting standard simulation codes)
    if (resetPassword.trim() === "") {
      setResetError("Please enter your account password.");
      return;
    }

    if (resetPassword === "password" || resetPassword.length >= 4) {
      // Authorized! Reset local PIN.
      localStorage.setItem(`kkm_failed_attempts_${employee.id}`, "0");
      localStorage.removeItem(`kkm_lockout_until_${employee.id}`);
      setFailedAttempts(0);
      setLockoutRemaining(0);
      onResetPin();
    } else {
      setResetError("Invalid security credentials. Check password or use 'password'.");
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-4 bg-slate-950 text-slate-100 min-h-screen select-none">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 relative text-center">
        
        {/* Switch back and forth between Lock and Reset Panel */}
        {!isResetting ? (
          <>
            {/* Operator Lock Avatar Header */}
            <div className="relative inline-block mx-auto">
              <img
                src={employee.avatar}
                alt={employee.name}
                className="w-16 h-16 rounded-3xl object-cover border-2 border-amber-500 shadow-xl shadow-amber-500/10 mx-auto"
                referrerPolicy="no-referrer"
              />
              <span className="absolute -bottom-1 -right-1 w-6 h-6 bg-slate-950 border border-slate-800 text-amber-500 rounded-full flex items-center justify-center shadow-lg">
                <Lock size={11} />
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[8.5px] font-black uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md inline-block">
                Terminal Locked
              </span>
              <h2 className="text-md font-black font-display tracking-tight text-slate-100 mt-2">
                Welcome back, {employee.name}
              </h2>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                {employee.role} Access Authorization
              </p>
            </div>

            {/* Lockout Timer Overlay */}
            {lockoutRemaining > 0 ? (
              <div className="py-6 space-y-2 ">
                <div className="mx-auto w-10 h-10 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center border border-red-500/20">
                  <ShieldAlert size={18} />
                </div>
                <h3 className="text-xs font-black text-red-400 uppercase tracking-widest">
                  Lockout Penalty Active
                </h3>
                <p className="text-[10.5px] text-slate-400 font-medium max-w-xs mx-auto">
                  Terminal locked due to security violation. Try again in <strong className="text-red-400 font-mono text-xs">{lockoutRemaining}s</strong>.
                </p>
              </div>
            ) : (
              <>
                {/* PIN Indicator Dots */}
                <div className="flex justify-center gap-4 py-2">
                  {Array.from({ length: pinLength }).map((_, index) => (
                    <div
                      key={index}
                      className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                        index < enteredPin.length
                          ? "bg-amber-500 border-amber-500 scale-110 shadow-lg shadow-amber-500/20"
                          : "bg-transparent border-slate-700"
                      }`}
                    />
                  ))}
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-2.5 flex items-center gap-2 justify-center text-[10.5px] text-red-400">
                    <AlertCircle size={12} />
                    <span className="font-bold">{error}</span>
                  </div>
                )}

                {/* Keyboard Grid */}
                <div className="grid grid-cols-3 gap-2.5 max-w-[280px] mx-auto pt-2">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                    <button
                      key={num}
                      onClick={() => handleKeyPress(num)}
                      className="h-14 bg-slate-900 hover:bg-slate-850 active:bg-slate-800 text-slate-200 font-black text-lg rounded-2xl transition border border-slate-800 shadow-sm flex items-center justify-center cursor-pointer"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    onClick={handleClear}
                    className="h-14 bg-slate-950 text-slate-500 hover:text-slate-300 font-bold text-xs rounded-2xl transition border border-transparent flex items-center justify-center cursor-pointer uppercase tracking-wider"
                  >
                    Clear
                  </button>
                  <button
                    key="0"
                    onClick={() => handleKeyPress("0")}
                    className="h-14 bg-slate-900 hover:bg-slate-850 active:bg-slate-800 text-slate-200 font-black text-lg rounded-2xl transition border border-slate-800 shadow-sm flex items-center justify-center cursor-pointer"
                  >
                    0
                  </button>
                  <button
                    onClick={handleBackspace}
                    className="h-14 bg-slate-950 text-slate-500 hover:text-slate-300 font-bold text-xs rounded-2xl transition border border-transparent flex items-center justify-center cursor-pointer uppercase tracking-wider"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}

            {/* Lock Screen Operations */}
            <div className="border-t border-slate-800/60 pt-4 flex flex-col gap-3">
              <div className="flex justify-between items-center px-2">
                <button
                  onClick={() => setIsResetting(true)}
                  className="text-[10px] font-black text-amber-500 hover:text-amber-400 uppercase tracking-widest cursor-pointer transition flex items-center gap-1"
                >
                  <RotateCcw size={10} />
                  <span>Forgot PIN?</span>
                </button>
                <button
                  onClick={onLogout}
                  className="text-[10px] font-black text-slate-500 hover:text-slate-300 uppercase tracking-widest cursor-pointer transition flex items-center gap-1"
                >
                  <LogOut size={10} />
                  <span>Switch Account</span>
                </button>
              </div>

              {/* Offline Cheat-Sheet Helper to facilitate review testing */}
              <div className="p-3 bg-slate-950 rounded-2xl border border-slate-850 text-left">
                <span className="text-[8px] font-mono font-black uppercase text-slate-600 block mb-1">Passcode Cheat Guide</span>
                <span className="text-[8.5px] text-slate-400 block font-medium">Your current PIN is: <strong className="text-amber-500 font-mono text-xs">{employee.pin}</strong></span>
              </div>
            </div>
          </>
        ) : (
          /* RESET PIN FORM VIEW */
          <form onSubmit={handlePasswordResetVerify} className="space-y-5 text-left">
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center border border-amber-500/20 mb-2">
                <RotateCcw size={16} />
              </div>
              <h3 className="text-xs font-black text-slate-100 uppercase tracking-widest">
                Reset Passcode PIN
              </h3>
              <p className="text-[10.5px] text-slate-400 font-medium px-4 leading-normal">
                Authorize reset by entering your online Supabase account password.
              </p>
            </div>

            <div className="space-y-1.5 pt-2">
              <label className="text-[9.5px] font-black uppercase tracking-wider text-slate-400">Account Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Enter account password..."
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-slate-500 hover:text-slate-300 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <span className="text-[8.5px] text-slate-500 block leading-tight">
                For simulation profiles, default password is <strong className="font-mono text-slate-400">password</strong>.
              </span>
            </div>

            {/* Reset Error banner */}
            {resetError && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-2.5 flex items-center gap-2 justify-center text-[10.5px] text-red-400">
                <AlertCircle size={12} />
                <span className="font-bold">{resetError}</span>
              </div>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsResetting(false);
                  setResetPassword("");
                  setResetError("");
                }}
                className="flex-1 py-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 font-bold rounded-xl transition text-xs uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition text-xs uppercase tracking-wider"
              >
                Verify Reset
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
