// First launch only: connect the app to its cloud database (project URL and anon key).
import { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle, Database, RefreshCw } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

export function DbConnectScreen({ onConnected }: { onConnected: () => void }) {
  const { showToast } = useAppStore();
  const [setupDbUrl, setSetupDbUrl] = useState('');
  const [setupDbKey, setSetupDbKey] = useState('');
  const [dbConnecting, setDbConnecting] = useState(false);
  const [setupDbError, setSetupDbError] = useState('');

  const handleConnectDatabase = async () => {
    if (!setupDbUrl || !setupDbKey) {
      setSetupDbError('Enter the project URL and the anon key.');
      return;
    }
    setDbConnecting(true);
    setSetupDbError('');
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(setupDbUrl, setupDbKey);
      if (client) {
        localStorage.setItem('kkm_supabase_url', setupDbUrl);
        localStorage.setItem('kkm_supabase_key', setupDbKey);
        onConnected();
        showToast('Connected', 'The app is connected.', undefined, 'success');
      }
    } catch (e) {
      setSetupDbError('Could not connect. Check the project URL and key.');
    } finally {
      setDbConnecting(false);
    }
  };

  return (
    <motion.div
      key="db-connect"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 min-h-0 flex flex-col items-center px-4 md:px-8 pt-[calc(1rem+var(--inset-top))] pb-[calc(1rem+var(--inset-bottom))] md:pt-[calc(2rem+var(--inset-top))] md:pb-[calc(2rem+var(--inset-bottom))] bg-slate-950 text-slate-100 overflow-y-auto select-none"
    >
      <div className="my-auto shrink-0 w-full max-w-md bg-slate-900 border border-slate-800 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 space-y-5 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-950 font-bold text-lg">
            <Database size={22} />
          </div>
          <h1 className="text-xl font-bold font-display tracking-tight text-amber-500">
            Database Sync setup
          </h1>
          <p className="text-[10px] text-slate-400 font-bold">
            First Launch Configuration
          </p>
        </div>

        <p className="text-[10.5px] text-slate-400 font-medium leading-relaxed text-center">
          Configure your cloud Supabase database URL and anonymous API
          keys to synchronize local offline transactions.
        </p>

        <div className="space-y-3.5">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400 font-semibold block">
              Supabase Project URL
            </label>
            <input
              type="text"
              value={setupDbUrl}
              onChange={(e) => setSetupDbUrl(e.target.value)}
              placeholder="https://your-project.supabase.co"
              className="w-full bg-slate-950 text-xs text-slate-100 px-3 py-2 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400 font-semibold block">
              Supabase Anon Key
            </label>
            <input
              type="text"
              value={setupDbKey}
              onChange={(e) => setSetupDbKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full bg-slate-950 text-xs text-slate-100 px-3 py-2 rounded-xl border border-slate-800 focus:border-amber-500 focus:outline-none font-mono"
            />
          </div>

          {setupDbError && (
            <p className="text-[10px] text-red-400 font-bold leading-normal text-center">
              {setupDbError}
            </p>
          )}

          <button
            type="button"
            onClick={handleConnectDatabase}
            disabled={dbConnecting}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold rounded-xl text-xs cursor-pointer transition flex items-center justify-center gap-1.5"
          >
            {dbConnecting ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            <span>
              {dbConnecting ? 'Testing Sync...' : 'Connect Database'}
            </span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
