import React from "react";
import { ShieldAlert, Key, Lock } from "lucide-react";
import { PermissionCode, ALL_PERMISSIONS, hasRolePermission } from "../utils/permissions";
import { useAuthStore } from "../stores/authStore";

interface SecurityGuardProps {
  permission: PermissionCode;
  children: React.ReactNode;
}

export default function SecurityGuard({ permission, children }: SecurityGuardProps) {
  const { currentEmployee } = useAuthStore();
  const activeRoleName = currentEmployee?.role || "Guest";
  const isGranted = currentEmployee ? hasRolePermission(currentEmployee.role, permission) : false;

  if (isGranted) {
    return <>{children}</>;
  }

  const pDetails = ALL_PERMISSIONS.find(p => p.code === permission);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-app-bg text-app-text select-none animate-fade-in font-sans">
      <div className="max-w-xs w-full text-center space-y-5 bg-app-card border border-app-border p-6 rounded-3xl shadow-xl">
        {/* Animated Lock Shield */}
        <div className="relative mx-auto w-16 h-16 bg-red-500/10 dark:bg-red-500/5 text-red-500 rounded-full flex items-center justify-center border border-red-500/20">
          <Lock size={24} className="" />
          <div className="absolute -top-1 -right-1 p-0.5 bg-red-500 text-slate-950 rounded-full border-2 border-app-card">
            <ShieldAlert size={10} />
          </div>
        </div>

        {/* Revocation Text */}
        <div className="space-y-1.5">
          <span className="px-2 py-0.5 bg-red-500/10 text-red-500 rounded font-mono text-[9px] font-black tracking-widest uppercase">
            Access Denied
          </span>
          <h3 className="font-display font-black text-sm text-slate-900 dark:text-slate-100 leading-tight">
            Security Privilege Limit
          </h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
            Your active profile role <strong className="text-slate-800 dark:text-slate-200">"{activeRoleName}"</strong> does not hold the necessary digital security clearance code.
          </p>
        </div>

        {/* Required Permission Code Card */}
        <div className="bg-app-bg border border-app-border rounded-xl p-3 text-left space-y-1">
          <span className="text-[8px] text-slate-400 dark:text-slate-500 font-extrabold uppercase block tracking-wider">Required Code</span>
          <code className="text-[10px] font-mono font-bold text-red-500 block break-all">
            {permission}
          </code>
          {pDetails && (
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-snug">
              {pDetails.description}
            </p>
          )}
        </div>

        {/* Instruction Info */}
        <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-start gap-2 text-left">
          <Key className="text-amber-500 shrink-0 mt-0.5" size={13} />
          <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">
            Your current logged-in role <strong>{activeRoleName}</strong> does not have access to this module. To view this feature, please switch employee profiles using the <strong>Active Employee Picker</strong> on the left pane.
          </p>
        </div>
      </div>
    </div>
  );
}
