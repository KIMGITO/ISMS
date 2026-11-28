// Someone in more than one branch picks the branch before any screen opens (each app
// start and sign-in). Picking happens in the chooser, the branch list or by creating one.
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { getSupabase } from '../services/supabaseClient';
import { isBranchChosen, BRANCH_CHOSEN_EVENT } from '../utils/branchChoice';

export function useBranchChooser() {
  const { currentUser, memberships, activeBusinessId } = useAppStore();
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  const [, setBranchChoiceTick] = useState(0);
  useEffect(() => {
    const onChosen = () => setBranchChoiceTick((t) => t + 1);
    window.addEventListener(BRANCH_CHOSEN_EVENT, onChosen);
    return () => window.removeEventListener(BRANCH_CHOSEN_EVENT, onChosen);
  }, []);
  const myBranchCount = currentUser
    ? memberships.filter((m) => m.userId === currentUser.id && m.status === 'Active').length
    : 0;
  const mustChooseBranch =
    !!currentUser?.isVerified && myBranchCount > 1 && !isBranchChosen(currentUser.id, activeBusinessId);
  const showBranchChooser = showWorkspaceSwitcher || mustChooseBranch;
  // Company names for the chooser's headings (only when the person works for two companies).
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!showBranchChooser || !currentUser) return;
    let live = true;
    getSupabase()
      .from('tenants')
      .select('id, name')
      .then(({ data }) => {
        if (live && data) setCompanyNames(Object.fromEntries(data.map((t: any) => [t.id, t.name])));
      });
    return () => {
      live = false;
    };
  }, [showBranchChooser, currentUser?.id]);

  return { showBranchChooser, setShowWorkspaceSwitcher, companyNames };
}
