// Someone in more than one branch picks the one they are working in, grouped by company.
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { setConsoleOpen } from '../../utils/platformConsole';
import { WorkspaceLogo } from '../WorkspaceLogo';
import type { User } from '../../types';

export function BranchChooser({
  currentUser,
  companyNames,
  isPlatformAdmin,
  onCloseBranchChooser,
}: {
  currentUser: User;
  /** Company names for the headings, by tenant id. */
  companyNames: Record<string, string>;
  isPlatformAdmin: boolean;
  onCloseBranchChooser: () => void;
}) {
  const { memberships, businesses, switchBusiness, logout } = useAppStore();
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="text-center space-y-1">
        <h2 className="text-xs font-semibold text-amber-600">
          Choose a branch
        </h2>
        <p className="text-[10px] text-slate-500">
          You work in more than one branch. Pick the one you are working in now.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 max-h-[300px] overflow-y-auto">
        {memberships
          .filter(
            (m) =>
              m.userId === currentUser.id &&
              m.status === 'Active',
          )
          // Grouped by company, so branches of different businesses never mix.
          .map((m) => ({ m, tenant: businesses.find((b) => b.id === m.businessId)?.tenantId || '' }))
          .sort((a, b) => a.tenant.localeCompare(b.tenant))
          .map(({ m, tenant }, index, list) => {
            const companyCount = new Set(list.map((x) => x.tenant)).size;
            const startsCompany = companyCount > 1 && (index === 0 || list[index - 1].tenant !== tenant);
            const biz = businesses.find(
              (b) => b.id === m.businessId,
            ) || {
              id: m.businessId,
              name: 'New branch',
              logoUrl:
                "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Crect width='100' height='100' rx='20'/%3E%3Cpath d='M30,70 L50,30 L70,70 Z' fill='%230f172a'/%3E%3C/svg%3E",
            };
            return (
              <React.Fragment key={m.id}>
              {startsCompany && (
                <h3 className="text-[11px] font-semibold text-slate-500 pt-1">
                  {companyNames[tenant] || 'Business'}
                </h3>
              )}
              <button
                onClick={() => {
                  switchBusiness(m.businessId);
                  onCloseBranchChooser();
                }}
                className="w-full p-4 bg-white hover:bg-slate-100 border border-slate-200 hover:border-amber-500/30 rounded-2xl flex items-center justify-between transition group text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <WorkspaceLogo
                    logoUrl={biz.logoUrl}
                    name={biz.name}
                  />
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 group-hover:text-amber-600 transition-colors">
                      {biz.name}
                    </h4>
                    <span className="text-[11px] font-semibold text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {m.role}
                    </span>
                  </div>
                </div>
                <ArrowRight
                  size={14}
                  className="text-slate-500 group-hover:text-amber-600 transition-colors"
                />
              </button>
              </React.Fragment>
            );
          })}
      </div>

      {isPlatformAdmin && (
        <button
          type="button"
          onClick={() => setConsoleOpen(true)}
          className="w-full py-2.5 border border-amber-500/40 hover:bg-amber-500/10 text-amber-700 font-bold rounded-xl text-xs transition"
        >
          Platform console
        </button>
      )}
      <button
        onClick={() => logout()}
        className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition tracking-wide"
      >
        Log Out / Back to Login
      </button>
    </div>
  );
}
