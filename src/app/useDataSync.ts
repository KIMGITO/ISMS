// Loading the shared data (branches, staff, products, customers, settings) and the sales
// sync, plus pull-to-refresh and the reload button (F5 / Ctrl+R on big screens).
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useAuthStore } from '../stores/authStore';
import { useBusinessStore } from '../stores/businessStore';
import { isSupabaseConfigured, getSupabase } from '../services/supabaseClient';
import { SupabaseService } from '../services/supabaseService';
import { ProductRepository, CustomerRepository } from '../services/repositories';

export function useDataSync() {
  const { isOnline, syncWithServer, showToast, activeBusinessId } = useAppStore();

  useEffect(() => {
    if (isOnline) {
      syncWithServer().catch((err) =>
        console.error('Live context sync breakdown:', err),
      );
    }
  }, [isOnline, syncWithServer]);

  // Load and hydrate all data from Supabase if configured.
  // Also run by pull-to-refresh, so it lives outside the effect.
  const syncSupabaseData = async () => {
      if (!isOnline) return;
      if (isSupabaseConfigured()) {
        try {
          // Nothing to load before sign-in: every table needs a signed-in account.
          const { data: { session } } = await getSupabase().auth.getSession();
          if (!session) return;
          console.log('Supabase is configured. Synchronizing data...');

          // 1. Fetch businesses
          const fetchedBiz = await SupabaseService.fetchBusinesses();
          if (fetchedBiz && fetchedBiz.length > 0) {
            useBusinessStore.getState().setBusinesses(fetchedBiz);

            // If active business ID is 'biz-1' (the mock fallback), point it to a real UUID business ID from Supabase
            if (
              activeBusinessId === 'biz-1' ||
              !fetchedBiz.some((b) => b.id === activeBusinessId)
            ) {
              useBusinessStore.getState().setActiveBusinessId(fetchedBiz[0].id);
            }
          }

          // 2. Fetch employees
          const fetchedEmps = await SupabaseService.fetchEmployees();
          if (fetchedEmps && fetchedEmps.length > 0) {
            useAuthStore.getState().setEmployees(fetchedEmps);
          }

          // 3. Fetch products and customers for the active business
          const currentBizId = useBusinessStore.getState().activeBusinessId;
          if (currentBizId && currentBizId !== 'biz-1') {
            // The open product and customer lists reload themselves (they used to be
            // downloaded here in full and then thrown away).
            await Promise.all([ProductRepository.reload(), CustomerRepository.reload()]);

            // Receipt, printer, SMS… settings (kept on the device between refreshes)
            await useBusinessStore.getState().fetchAllIntegrationConfigs();
          }

          console.log('Supabase synchronization completed successfully.');
        } catch (err) {
          console.error('Error during Supabase synchronization:', err);
        }
      }
  };

  useEffect(() => {
    syncSupabaseData();
  }, [isOnline, activeBusinessId]);

  // Pull to refresh: reload shared data, then reopen the current screen so it
  // fetches its own data again. The open cart lives in a store and is kept.
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshApp = async () => {
    if (!navigator.onLine) {
      showToast('Offline', 'Connect to the internet to refresh.', undefined, 'info');
      return;
    }
    await Promise.all([
      syncSupabaseData(),
      syncWithServer().catch((err) => console.error('Refresh: sales sync failed', err)),
    ]);
    setRefreshKey((k) => k + 1);
  };

  // The reload button and F5 / Ctrl+R on big screens: the same as pulling down on a phone.
  const [isReloading, setIsReloading] = useState(false);
  const isReloadingRef = useRef(false);
  const reloadNow = async () => {
    if (isReloadingRef.current) return;
    isReloadingRef.current = true;
    setIsReloading(true);
    try {
      await refreshApp();
      if (navigator.onLine) showToast('Up to date', 'Latest sales, stock and payments loaded.', undefined, 'success');
    } catch {
      showToast('Not reloaded', 'Could not fetch the latest data. Try again.', undefined, 'error');
    } finally {
      isReloadingRef.current = false;
      setIsReloading(false);
    }
  };

  return { refreshKey, refreshApp, isReloading, reloadNow };
}
