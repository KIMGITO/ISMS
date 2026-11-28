// Toasts: a brief pill for your own actions, a card for alerts and messages.
import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CloudOff } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { canOpenScreen } from '../utils/screens';
import type { ActiveBusiness } from './types';

export function AppToast({ activeBusiness }: { activeBusiness: ActiveBusiness }) {
  const { toast, clearToast, setActiveTab, currentEmployee } = useAppStore();
  return (
    <AnimatePresence>
      {toast && (() => {
        const toastBottom = { '--popup-bottom': 'calc(var(--mobile-nav-height) + var(--mobile-nav-gap) * 2 + var(--inset-bottom))' } as React.CSSProperties;
        if (toast.quiet) {
          return (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: 12, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 460, damping: 30 }}
              style={toastBottom}
              onClick={clearToast}
              className="absolute bottom-(--popup-bottom) md:bottom-6 left-1/2 -translate-x-1/2 z-[9999] max-w-[calc(100%-1rem)] px-3.5 py-2 rounded-full bg-slate-900/90 dark:bg-slate-100/90 text-white dark:text-slate-900 backdrop-blur-md shadow-lg flex items-center gap-2 text-sm font-medium select-none cursor-pointer"
            >
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
              {/* Generic titles ("Success", "Saved") say less than the message itself */}
              <span className="truncate">
                {/^(success|saved|done|ok|updated)$/i.test(toast.sender.trim()) ? toast.message : toast.sender}
              </span>
            </motion.div>
          );
        }
        // Picture: the sender's own, else the business logo, else your profile photo.
        const businessLogo = activeBusiness?.logoUrl || '';
        const picture = toast.avatar || businessLogo || currentEmployee?.avatar || '';
        const isBusinessPicture = !toast.avatar && !!businessLogo;
        const canOpenBusiness = !!currentEmployee && canOpenScreen(currentEmployee.role, 'business-management');
        return (
          <motion.div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={toastBottom}
            onClick={clearToast}
            className={`absolute bottom-(--popup-bottom) md:bottom-6 left-1 right-1 md:left-auto md:right-6 md:w-[380px] z-[9999] backdrop-blur-md rounded-xl p-3 shadow-xl flex items-center gap-3 cursor-pointer select-none ${
              toast.type === 'offline'
                ? 'bg-rose-700/95 dark:bg-rose-800/95 text-white' // saved offline: solid red, not an error
                : toast.type === 'error'
                ? 'bg-red-50/95 dark:bg-slate-950/95 ring-1 ring-red-500/30'
                : 'bg-white/95 dark:bg-slate-900/95'
            }`}
          >
            {toast.type === 'offline' ? (
              <>
                <span className="w-10 h-10 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
                  <CloudOff size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{toast.sender}</p>
                  <p className="text-xs mt-0.5 text-white/85 line-clamp-2">{toast.message}</p>
                </div>
              </>
            ) : (<>
            <button
              type="button"
              aria-label={isBusinessPicture && canOpenBusiness ? `Open ${activeBusiness?.name || 'business'} page` : undefined}
              tabIndex={isBusinessPicture && canOpenBusiness ? 0 : -1}
              onClick={(e) => {
                if (!isBusinessPicture || !canOpenBusiness) return;
                e.stopPropagation();
                clearToast();
                setActiveTab('business-management' as any);
              }}
              className="relative shrink-0 rounded-full"
            >
              {picture ? (
                <img src={picture} alt="" className="w-10 h-10 rounded-full object-cover bg-app-bg" referrerPolicy="no-referrer" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center font-bold">
                  {(activeBusiness?.name || toast.sender || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                  toast.type === 'error' ? 'bg-red-500' : toast.type === 'info' ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{toast.sender}</p>
              <p
                className={`text-xs mt-0.5 ${
                  toast.type === 'error'
                    ? 'text-red-700 dark:text-red-300 break-words line-clamp-3'
                    : 'text-slate-600 dark:text-slate-300 line-clamp-2'
                }`}
              >
                {toast.message}
              </p>
            </div>
            </>)}
          </motion.div>
        );
      })()}
    </AnimatePresence>
  );
}
