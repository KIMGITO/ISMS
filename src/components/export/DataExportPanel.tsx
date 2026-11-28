// src/components/export/DataExportPanel.tsx
// Settings → Export data. Pick a period (last 30 days by default), press Export, watch the
// progress and the workbook downloads. On failure, Retry carries on from the step that failed.
import { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, RotateCcw } from 'lucide-react';
import { Segmented } from '../shared/Choice';
import { TextInput } from '../shared/Input';
import ProgressBar from '../shared/ProgressBar';
import { ExportJob, ExportProgress } from '../../services/dataExport';
import fileService from '../../core/native/FileService';
import { useBusinessStore } from '../../stores/businessStore';
import { useAppStore } from '../../stores/appStore';
import { toUserMessage } from '../../utils/userError';

type Period = '7' | '30' | '90' | '365' | 'custom';

const isoDay = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const SHEETS = 'Summary, Charts, Daily sales, Sales, Product sales, Items sold, Expenses, Customer payments, Supplier payments, Products and stock, Customers, Profit and loss, Books';

export default function DataExportPanel({ businessId }: { businessId: string }) {
  const { showToast } = useAppStore();
  const businessName = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId)?.name) || 'Business';
  const [period, setPeriod] = useState<Period>('30');
  const [from, setFrom] = useState(isoDay(daysAgo(30)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const job = useRef<{ key: string; job: ExportJob } | null>(null);

  const range = useMemo(() => {
    if (period === 'custom') {
      return { start: new Date(`${from}T00:00:00`), end: new Date(`${to}T23:59:59.999`) };
    }
    const start = daysAgo(Number(period));
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [period, from, to]);
  const badRange = !(range.start.getTime() <= range.end.getTime());

  const run = async (retry = false) => {
    if (running || badRange) return;
    const key = `${businessId}|${range.start.toISOString()}|${range.end.toISOString()}`;
    if (!retry || !job.current || job.current.key !== key) {
      job.current = { key, job: new ExportJob(businessId, range.start, range.end, businessName) };
    }
    setRunning(true);
    setError(null);
    setProgress({ percent: 0, label: 'Starting' });
    try {
      const { blob, filename } = await job.current.job.run(setProgress);
      setProgress({ percent: 100, label: 'Saving the file' });
      await fileService.saveFile(filename, blob, blob.type);
      showToast('Export ready', `${filename} was saved.`, undefined, 'success');
      job.current = null;
      setProgress(null);
    } catch (err) {
      console.error('Export failed:', err);
      setError(toUserMessage(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="size-10 shrink-0 rounded-2xl bg-app-bg ring-1 ring-app-border flex items-center justify-center">
          <FileSpreadsheet className="size-5 text-amber-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-app-text">Export data</h3>
          <p className="text-xs text-app-text-muted">One Excel workbook with a summary, charts and a sheet for each kind of record.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-app-text">Period</span>
        <Segmented<Period>
          ariaLabel="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { id: '7', label: '7 days' },
            { id: '30', label: '30 days' },
            { id: '90', label: '90 days' },
            { id: '365', label: '1 year' },
            { id: 'custom', label: 'Pick dates' },
          ]}
        />
        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-app-text-muted">
              From
              <TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-app-text-muted">
              To
              <TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} invalid={badRange} />
            </label>
          </div>
        )}
      </div>

      <p className="text-[11px] text-app-text-muted">Sheets: {SHEETS}.</p>

      {progress && <ProgressBar percent={progress.percent} label={progress.label} />}
      {error && (
        <div className="rounded-2xl bg-red-500/10 ring-1 ring-red-500/30 p-3 text-xs text-red-600 dark:text-red-400">
          The export stopped: {error}
        </div>
      )}

      <div className="flex gap-2">
        {error ? (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={running}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <RotateCcw className="size-4" /> Retry
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run(false)}
            disabled={running || badRange}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <Download className="size-4" /> {running ? 'Exporting' : 'Export'}
          </button>
        )}
      </div>
    </div>
  );
}
