// The plan of the open branch's company decides which modules show (planStore). Nothing
// opens before it is known for this person and branch: a saved copy counts, else the
// first answer (or failure) from the server.
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { usePlan, usePlanStore, startPlanWatch } from '../stores/planStore';

export function usePlanReady() {
  const { currentUser, activeBusinessId } = useAppStore();
  const plan = usePlan();
  useEffect(() => {
    if (currentUser) startPlanWatch();
  }, [currentUser?.id]);
  const planKey = currentUser?.isVerified && activeBusinessId ? `${currentUser.id}:${activeBusinessId}` : '';
  const [planCheckedFor, setPlanCheckedFor] = useState('');
  useEffect(() => {
    if (!planKey) return;
    let live = true;
    usePlanStore
      .getState()
      .loadPlan(activeBusinessId, true)
      .catch(() => null)
      .finally(() => {
        if (live) setPlanCheckedFor(planKey);
      });
    return () => {
      live = false;
    };
  }, [planKey]);
  const planReady = !planKey || !!plan || planCheckedFor === planKey;
  return { plan, planReady };
}
