// src/utils/branchChoice.ts
// Someone who works in more than one branch picks the branch before any screen opens, each
// time the app starts and after each sign-in (2026-11-24). The choice lasts for this app run
// (sessionStorage) and only for the person who made it.

const KEY = "kkm_branch_chosen_v1";
export const BRANCH_CHOSEN_EVENT = "kkm-branch-chosen";

function currentUserId(): string {
  try {
    return localStorage.getItem("kkm_current_user_id_v2") || "";
  } catch {
    return "";
  }
}

/** Records that the signed-in person chose this branch themselves. */
export function markBranchChosen(businessId: string, userId: string = currentUserId()): void {
  if (!businessId || !userId) return;
  try {
    sessionStorage.setItem(KEY, `${userId}:${businessId}`);
  } catch {
    /* blocked storage: the picker shows again, which is the safe side */
  }
  window.dispatchEvent(new Event(BRANCH_CHOSEN_EVENT));
}

export function isBranchChosen(userId: string | undefined, businessId: string | undefined | null): boolean {
  if (!userId || !businessId) return false;
  try {
    return sessionStorage.getItem(KEY) === `${userId}:${businessId}`;
  } catch {
    return false;
  }
}

export function clearBranchChoice(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing saved */
  }
}
