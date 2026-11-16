// Assets & Files: what the business owns (fridges, scales, motorbikes…) and the documents
// it keeps (licences, contracts, supplier invoices). Files live in a private bucket and
// open through short-lived links.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HardDrive, FileText, Plus, Search, Pencil, Trash2, RotateCcw, Upload, Download, ExternalLink, Image as ImageIcon, FileSpreadsheet, File,
} from 'lucide-react';
import { useBusinessStore, onBranchChange } from '../stores/businessStore';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { hasRolePermission } from '../utils/permissions';
import { toUserMessage } from '../utils/userError';
import { formatCurrency } from '../utils/helpers';
import { Tabs } from '../components/TabOptions';
import { SwipeRow } from '../components/shared/SwipeRow';
import { FormSheet, Field, fieldClass, primaryBtn, secondaryBtn } from '../components/shared/FormSheet';
import { appDialog } from '../components/AppDialog';
import { ReceiptShareService } from '../services/receipt/ReceiptShareService';
import {
  listAssets, saveAsset, deleteAsset, nextAssetCode, ASSET_STATUSES,
  listFiles, uploadFile, fileLink, deleteFile, FILE_ACCEPT,
  type Asset, type AssetDraft, type AssetStatus, type StoredFile,
} from '../services/operations';

type Tab = 'assets' | 'files';

const STATUS_STYLE: Record<AssetStatus, string> = {
  Active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'Under Repair': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  Disposed: 'bg-slate-500/15 text-app-text-muted',
  Sold: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

function FileIcon({ type }: { type: string }) {
  if (type.startsWith('image/')) return <ImageIcon size={18} />;
  if (type.includes('sheet') || type.includes('excel') || type === 'text/csv') return <FileSpreadsheet size={18} />;
  if (type === 'application/pdf' || type.includes('word') || type.startsWith('text/')) return <FileText size={18} />;
  return <File size={18} />;
}

export default function AssetsFilesView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const employee = useAuthStore((s) => s.currentEmployee);
  const role = employee?.role || 'Guest';
  const staffName = employee?.name || 'Staff';
  const showToast = useNotificationStore((s) => s.showToast);
  const can = (code: string) => hasRolePermission(role, code as any);

  const seesAssets = can('assets.view') || can('assets.manage');
  const managesAssets = can('assets.manage');
  const seesFiles = can('files.view') || can('files.manage');
  const managesFiles = can('files.manage');

  const tabs = [
    { id: 'assets' as Tab, label: 'Assets', icon: <HardDrive size={14} />, shortcut: 'assets-tab', allowed: seesAssets },
    { id: 'files' as Tab, label: 'Files', icon: <FileText size={14} />, shortcut: 'files-tab', allowed: seesFiles },
  ].filter((t) => t.allowed);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'assets');

  const [assets, setAssets] = useState<Asset[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'all'>('all');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [a, f] = await Promise.all([
        seesAssets ? listAssets(businessId) : Promise.resolve([]),
        seesFiles ? listFiles(businessId) : Promise.resolve([]),
      ]);
      setAssets(a);
      setFiles(f);
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load assets and files. Check your connection.'));
    } finally {
      setLoading(false);
    }
  }, [businessId, seesAssets, seesFiles]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => onBranchChange(() => { setAssets([]); setFiles([]); }), []);

  const q = query.trim().toLowerCase();
  const shownAssets = assets.filter((a) =>
    (statusFilter === 'all' || a.status === statusFilter)
    && (!q || [a.name, a.code, a.serialNumber, a.location, a.notes].some((v) => v.toLowerCase().includes(q))));
  const shownFiles = files.filter((f) => !q || [f.name, f.uploadedBy, f.notes].some((v) => v.toLowerCase().includes(q)));
  const activeValue = useMemo(
    () => assets.filter((a) => a.status === 'Active' || a.status === 'Under Repair').reduce((s, a) => s + a.value, 0),
    [assets],
  );

  // ---------------------------------------------------------------- assets
  const [editing, setEditing] = useState<{ id?: string; draft: AssetDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openNewAsset = () => {
    setFormError(null);
    setEditing({ draft: { name: '', code: nextAssetCode(assets), serialNumber: '', value: 0, status: 'Active', location: '', purchasedOn: '', notes: '' } });
  };

  const submitAsset = async () => {
    if (!editing || !businessId || busy) return;
    const d = editing.draft;
    if (!d.name.trim()) return setFormError('Enter what the asset is, e.g. Milk cooler 500 L.');
    if (!d.code.trim()) return setFormError('Give it a code so it can be labelled, e.g. AST-001.');
    if (assets.some((a) => a.id !== editing.id && a.code.trim().toLowerCase() === d.code.trim().toLowerCase())) {
      return setFormError(`${d.code.trim()} is already used by another asset.`);
    }
    if (!(Number(d.value) >= 0)) return setFormError('The value can\'t be below zero.');
    setFormError(null);
    setBusy(true);
    try {
      await saveAsset(businessId, d, editing.id);
      showToast(editing.id ? 'Asset saved' : 'Asset added', `${d.code} · ${d.name}`, undefined, 'success');
      setEditing(null);
      void load();
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the asset.'));
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = async (a: Asset) => {
    const ok = await appDialog.confirm({
      title: `Delete ${a.name}?`,
      message: 'To keep its record, mark it Sold or Disposed instead.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteAsset(a.id);
      setAssets((list) => list.filter((x) => x.id !== a.id));
      setEditing(null);
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete the asset.'), undefined, 'error');
    }
  };

  // ---------------------------------------------------------------- files
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const onPickFiles = async (list: FileList | null) => {
    if (!list?.length || !businessId) return;
    const picked = Array.from(list);
    let done = 0;
    for (const f of picked) {
      setUploading(`${f.name} (${done + 1} of ${picked.length})`);
      try {
        await uploadFile(businessId, f, staffName);
        done += 1;
      } catch (err) {
        showToast('Not uploaded', toUserMessage(err, `${f.name} could not be uploaded.`), undefined, 'error');
      }
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = '';
    if (done) showToast('Uploaded', `${done} ${done === 1 ? 'file' : 'files'} saved.`, undefined, 'success');
    void load();
  };

  const openFile = async (f: StoredFile, download = false) => {
    try {
      const url = await fileLink(f, download);
      await ReceiptShareService.openExternalUrl(url);
    } catch (err) {
      showToast('Could not open', toUserMessage(err, 'Could not open the file.'), undefined, 'error');
    }
  };

  const removeFile = async (f: StoredFile) => {
    const ok = await appDialog.confirm({ title: `Delete ${f.name}?`, message: 'The file is removed for good.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await deleteFile(f);
      setFiles((list) => list.filter((x) => x.id !== f.id));
    } catch (err) {
      showToast('Not deleted', toUserMessage(err, 'Could not delete the file.'), undefined, 'error');
    }
  };

  if (!tabs.length) {
    return <div className="h-full grid place-items-center p-6 text-sm text-app-text-muted">Your role can't see assets or files.</div>;
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-app-bg pb-nav">
      <div className="max-w-5xl mx-auto px-3 pt-3 sm:px-5 sm:pt-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {tabs.length > 1 && <Tabs<Tab> tabs={tabs} activeTab={tab} onChange={(t) => { setTab(t); setQuery(''); }} className="w-full sm:w-auto sm:flex-1 min-w-0 !pb-2" />}
          {tab === 'assets' && managesAssets && (
            <button data-shortcut="new" onClick={openNewAsset} className={`${primaryBtn} ml-auto`}>
              <Plus size={16} /> Add asset
            </button>
          )}
          {tab === 'files' && managesFiles && (
            <>
              <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => void onPickFiles(e.target.files)} />
              <button data-shortcut="new" disabled={!!uploading} onClick={() => fileInput.current?.click()} className={`${primaryBtn} ml-auto`}>
                <Upload size={16} /> {uploading ? 'Uploading…' : 'Upload files'}
              </button>
            </>
          )}
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'assets' ? 'Search by name, code, serial or where it is' : 'Search files by name or who uploaded'}
            className={`${fieldClass} pl-9 bg-app-card`}
          />
        </div>

        {tab === 'assets' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-wrap bg-app-card rounded-xl p-1 ring-1 ring-app-border">
              {(['all', ...ASSET_STATUSES] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${statusFilter === s ? 'bg-amber-500 text-slate-950' : 'text-app-text-muted'}`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
            {activeValue > 0 && <span className="text-xs text-app-text-muted">In use: <b className="text-app-text tabular-nums">{formatCurrency(activeValue)}</b></span>}
          </div>
        )}
        {tab === 'files' && uploading && <p className="text-xs text-app-text-muted">Uploading {uploading}…</p>}

        {loading ? (
          <p className="p-6 text-sm text-app-text-muted text-center">Loading…</p>
        ) : loadError ? (
          <div className="p-6 text-center space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-app-text underline cursor-pointer">
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        ) : tab === 'assets' ? (
          shownAssets.length === 0 ? (
            <p className="p-6 text-sm text-app-text-muted text-center">
              {assets.length ? 'No asset matches.' : 'No assets yet. Add what the business owns, like coolers, scales, motorbikes and computers.'}
            </p>
          ) : (
            <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
              {shownAssets.map((a) => (
                <SwipeRow
                  key={a.id}
                  as="li"
                  searchId={`asset-${a.id}`}
                  title={`${a.code} · ${a.name}`}
                  subtitle={`${formatCurrency(a.value)} · ${a.status}`}
                  onClick={() => managesAssets && (setFormError(null), setEditing({ id: a.id, draft: { ...a } }))}
                  actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !managesAssets, onClick: () => void removeAsset(a) }]}
                  contentClassName={`flex items-start gap-3 px-4 py-3 ${managesAssets ? 'cursor-pointer hover:bg-app-bg/50' : ''}`}
                >
                  <span className="grid place-items-center size-9 shrink-0 rounded-xl bg-app-bg text-app-text-muted"><HardDrive size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-app-text truncate">{a.name}</p>
                    <p className="text-[11px] text-app-text-muted mt-0.5 break-words">
                      {a.code}{a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}{a.location ? ` · ${a.location}` : ''}{a.purchasedOn ? ` · bought ${shortDate(a.purchasedOn)}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-app-text tabular-nums">{formatCurrency(a.value)}</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                  </div>
                </SwipeRow>
              ))}
            </ul>
          )
        ) : shownFiles.length === 0 ? (
          <p className="p-6 text-sm text-app-text-muted text-center">
            {files.length ? 'No file matches.' : 'No files yet. Keep licences, contracts and supplier invoices here (photos, PDF, Word, Excel; up to 20 MB each).'}
          </p>
        ) : (
          <ul className="bg-app-card rounded-2xl ring-1 ring-app-border/70 overflow-hidden divide-y divide-app-border/60">
            {shownFiles.map((f) => (
              <SwipeRow
                key={f.id}
                as="li"
                searchId={`file-${f.id}`}
                title={f.name}
                subtitle={`${f.size} · ${f.uploadedBy}`}
                onClick={() => void openFile(f)}
                actions={[{ label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !managesFiles, onClick: () => void removeFile(f) }]}
                more={[
                  { label: 'Open', icon: <ExternalLink size={16} />, onClick: () => void openFile(f) },
                  { label: 'Download', icon: <Download size={16} />, onClick: () => void openFile(f, true) },
                  { label: 'Delete', icon: <Trash2 size={16} />, danger: true, hidden: !managesFiles, onClick: () => void removeFile(f) },
                ]}
                contentClassName="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-app-bg/50"
              >
                <span className="grid place-items-center size-9 shrink-0 rounded-xl bg-app-bg text-app-text-muted"><FileIcon type={f.type} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-app-text truncate">{f.name}</p>
                  <p className="text-[11px] text-app-text-muted mt-0.5 truncate">
                    {f.size} · {shortDate(f.date)} · {f.uploadedBy}{!f.path ? ' · not stored online' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => void openFile(f, true)} disabled={!f.path} title="Download" aria-label={`Download ${f.name}`} className="p-2 rounded-lg text-app-text-muted hover:bg-app-bg disabled:opacity-40 cursor-pointer">
                    <Download size={15} />
                  </button>
                  {managesFiles && (
                    <button onClick={() => void removeFile(f)} title="Delete" aria-label={`Delete ${f.name}`} className="p-2 rounded-lg text-app-text-muted hover:text-red-500 hover:bg-app-bg cursor-pointer hidden sm:block">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </SwipeRow>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <FormSheet
          title={editing.id ? 'Edit asset' : 'Add asset'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && (
                <button className={`${secondaryBtn} mr-auto text-red-600`} onClick={() => { const a = assets.find((x) => x.id === editing.id); if (a) void removeAsset(a); }}>
                  <Trash2 size={15} /> Delete
                </button>
              )}
              <button className={secondaryBtn} onClick={() => setEditing(null)}>Cancel</button>
              <button className={primaryBtn} disabled={busy} onClick={() => void submitAsset()}>{busy ? 'Saving…' : 'Save'}</button>
            </>
          }
        >
          <Field label="What it is">
            <input autoFocus value={editing.draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} placeholder="e.g. Milk cooler 500 L" maxLength={100} className={fieldClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code">
              <input value={editing.draft.code} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, code: e.target.value } })} maxLength={30} className={fieldClass} />
            </Field>
            <Field label="Serial number (optional)">
              <input value={editing.draft.serialNumber} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, serialNumber: e.target.value } })} maxLength={60} className={fieldClass} />
            </Field>
            <Field label="Value (KSh)">
              <input type="number" inputMode="decimal" min="0" step="any" value={editing.draft.value || ''} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, value: Number(e.target.value) } })} className={fieldClass} />
            </Field>
            <Field label="Bought on (optional)">
              <input type="date" value={editing.draft.purchasedOn} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, purchasedOn: e.target.value } })} className={fieldClass} />
            </Field>
          </div>
          <Field label="Where it is (optional)">
            <input value={editing.draft.location} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, location: e.target.value } })} placeholder="e.g. Main shop, back room" maxLength={80} className={fieldClass} />
          </Field>
          <div>
            <p className="text-xs font-medium text-app-text-muted mb-1">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {ASSET_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setEditing({ ...editing, draft: { ...editing.draft, status: s } })}
                  aria-pressed={editing.draft.status === s}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer ${editing.draft.status === s ? 'bg-amber-500 text-slate-950' : 'bg-app-bg text-app-text border border-app-border'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Field label="Notes (optional)">
            <textarea rows={2} value={editing.draft.notes} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })} placeholder="Warranty, service dates, who uses it…" maxLength={500} className={fieldClass} />
          </Field>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        </FormSheet>
      )}
    </div>
  );
}
