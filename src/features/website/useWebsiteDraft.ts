// One draft for the whole Website workspace, shared by every screen so the top bar always knows
// whether there is something to publish. Screens edit their own copy of a part and call
// savePart(); the store sends only that part, with the revision it loaded, so two people
// editing at once never silently overwrite each other.
import { create } from 'zustand';
import {
  DraftState,
  discardDraft,
  isConflict,
  loadDraft,
  publishDraft,
  putBackVersion,
  saveDraft,
  WebsiteDocument,
  WebsitePart,
} from '../../services/websiteDraft';
import { toUserMessage } from '../../utils/userError';

/** What an action did. `message` says why when it was refused. */
export interface Outcome {
  ok: boolean;
  message?: string;
  /** The version number a publish or put back made. */
  number?: number;
}

interface WebsiteDraftStore {
  businessId: string | null;
  draft: DraftState | null;
  loading: boolean;
  /** Why the last load failed; the workspace shows it with Try again. */
  loadError: string | null;
  /** Someone else saved first: the top bar offers Reload. */
  conflict: boolean;
  busy: 'saving' | 'publishing' | 'discarding' | null;
  /** Parts with edits not yet saved to the draft, so leaving a screen can warn first. */
  dirtyParts: WebsitePart[];
  setDirty: (part: WebsitePart, dirty: boolean) => void;
  load: (businessId: string) => Promise<void>;
  /** Puts parts of the document in the draft. Resolves false (with a message) when refused. */
  savePart: <K extends WebsitePart>(parts: Pick<WebsiteDocument, K>) => Promise<Outcome>;
  publish: (note: string) => Promise<Outcome>;
  discard: () => Promise<Outcome>;
  putBack: (versionId: string) => Promise<Outcome>;
}

export const useWebsiteDraft = create<WebsiteDraftStore>((set, get) => {
  const fail = (err: unknown, fallback: string) => {
    if (isConflict(err)) set({ conflict: true });
    return { ok: false, message: toUserMessage(err, fallback) };
  };

  return {
    businessId: null,
    draft: null,
    loading: false,
    loadError: null,
    conflict: false,
    busy: null,
    dirtyParts: [],

    setDirty: (part, dirty) => {
      const has = get().dirtyParts.includes(part);
      if (dirty && !has) set({ dirtyParts: [...get().dirtyParts, part] });
      if (!dirty && has) set({ dirtyParts: get().dirtyParts.filter((p) => p !== part) });
    },

    load: async (businessId) => {
      // A different shop never shows the previous shop's draft, even for a moment.
      if (get().businessId !== businessId) set({ draft: null });
      set({ businessId, loading: true, loadError: null, conflict: false });
      try {
        const draft = await loadDraft(businessId);
        if (get().businessId === businessId) set({ draft, loading: false });
      } catch (err) {
        if (get().businessId === businessId) {
          set({ loading: false, loadError: toUserMessage(err, 'Could not open the website. Check your connection and try again.') });
        }
      }
    },

    savePart: async (parts) => {
      const { businessId, draft } = get();
      if (!businessId || !draft) return { ok: false, message: 'The website is still loading.' };
      set({ busy: 'saving' });
      try {
        const result = await saveDraft(businessId, parts, draft.revision);
        if (get().businessId === businessId) {
          set({
            draft: {
              ...draft,
              document: { ...draft.document, ...parts },
              revision: result.revision,
              changed: result.changed,
              savedAt: new Date().toISOString(),
            },
          });
        }
        return { ok: true };
      } catch (err) {
        return fail(err, 'Could not save to the draft.');
      } finally {
        set({ busy: null });
      }
    },

    publish: async (note) => {
      const { businessId, draft } = get();
      if (!businessId || !draft) return { ok: false, message: 'The website is still loading.' };
      set({ busy: 'publishing' });
      try {
        const { number } = await publishDraft(businessId, draft.revision, note);
        await get().load(businessId);
        return { ok: true, number };
      } catch (err) {
        return fail(err, 'Could not publish the website.');
      } finally {
        set({ busy: null });
      }
    },

    discard: async () => {
      const { businessId } = get();
      if (!businessId) return { ok: false, message: 'The website is still loading.' };
      set({ busy: 'discarding' });
      try {
        await discardDraft(businessId);
        await get().load(businessId);
        return { ok: true };
      } catch (err) {
        return fail(err, 'Could not throw the draft away.');
      } finally {
        set({ busy: null });
      }
    },

    putBack: async (versionId) => {
      const { businessId } = get();
      if (!businessId) return { ok: false, message: 'The website is still loading.' };
      set({ busy: 'publishing' });
      try {
        const { number } = await putBackVersion(businessId, versionId);
        await get().load(businessId);
        return { ok: true, number };
      } catch (err) {
        return fail(err, 'Could not put that version back.');
      } finally {
        set({ busy: null });
      }
    },
  };
});

/** The draft document; only call inside the workspace, which renders screens once it has loaded. */
export function useWebsiteDocument(): WebsiteDocument {
  return useWebsiteDraft((s) => s.draft!.document);
}
