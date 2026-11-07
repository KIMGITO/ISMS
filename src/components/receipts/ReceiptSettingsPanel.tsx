import React, { useEffect, useMemo, useState } from 'react';
import { ReceiptText, Save, Printer, Bluetooth, Wifi, Trash2, Star, RefreshCw, ShieldCheck, ShieldAlert, Unplug } from 'lucide-react';
import { Tabs } from '../TabOptions';
import { Switch } from '../shared/Switch';
import { useAppStore } from '../../stores/appStore';
import { useBusinessStore } from '../../stores/businessStore';
import { hasRolePermission } from '../../utils/permissions';
import { toUserMessage } from '../../utils/userError';
import { ReceiptService } from '../../services/receipt/ReceiptService';
import { BusinessReceiptSettings, ExtraQrOption } from '../../services/receipt/types';
import { buildReceiptContent } from '../../services/receipt/ReceiptGenerator';
import { buildReceiptLines, columnsFor } from '../../services/receipt/layout';
import { printerService } from '../../services/printer/PrinterService';
import { DevicePrinterPrefs, PrinterTarget } from '../../services/printer/types';
import { kraService, KraSettings, useKraStatus } from '../../services/kra/kraService';
import { ReceiptPaper } from './ReceiptPaper';
import { PrinterPicker } from './PrinterPicker';

type Tab = 'layout' | 'shop' | 'messages' | 'codes' | 'printers' | 'kra';

const TABS: { id: Tab; label: string }[] = [
  { id: 'layout', label: 'Paper & format' },
  { id: 'shop', label: 'Shop details' },
  { id: 'messages', label: 'Messages' },
  { id: 'codes', label: 'Codes' },
  { id: 'printers', label: 'Printers' },
  { id: 'kra', label: 'KRA eTIMS' },
];

const label = 'block text-xs font-medium text-app-text-muted mb-1';
const input = 'w-full bg-app-bg text-app-text px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500';

function Field({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-app-text-muted">{hint}</span>}
    </label>
  );
}

export default function ReceiptSettingsPanel() {
  const { showToast, currentEmployee, transactions } = useAppStore();
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);
  const receiptConfig = useBusinessStore((s) => s.integrationConfigs['receipt']);
  const role = currentEmployee?.role || 'Staff';
  const canConnectKra = hasRolePermission(role, 'settings.integrations');

  const [tab, setTab] = useState<Tab>('layout');
  const [settings, setSettings] = useState<BusinessReceiptSettings>(() => ReceiptService.getSettings(activeBusinessId || ''));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (activeBusinessId && !dirty) setSettings(ReceiptService.getSettings(activeBusinessId));
  }, [activeBusinessId, receiptConfig]);

  const update = (patch: Partial<BusinessReceiptSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await ReceiptService.saveSettings(settings);
      setDirty(false);
      showToast('Saved', 'Receipt settings saved.', undefined, 'success');
    } catch (err) {
      showToast('Not saved', toUserMessage(err, 'Could not save the receipt settings.'), undefined, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Preview with the most recent real sale; there is no made-up sample.
  const latestSale = useMemo(() => {
    const list = Array.isArray(transactions) ? transactions : [];
    return list.reduce<(typeof list)[number] | null>((a, b) => (!a || new Date(b.timestamp) > new Date(a.timestamp) ? b : a), null);
  }, [transactions]);
  const previewLines = useMemo(
    () => (latestSale ? buildReceiptLines(buildReceiptContent(latestSale, settings), settings) : null),
    [latestSale, settings],
  );

  return (
    <div className="bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 flex flex-col gap-4" id="receipt-engine-customization-settings">
      <div className="flex items-center gap-2">
        <ReceiptText size={18} className="text-amber-500" />
        <h3 className="text-sm font-semibold text-app-text">Receipts & printing</h3>
        {dirty && <span className="ml-auto text-xs text-amber-600">Unsaved changes</span>}
      </div>

      <Tabs<Tab> tabs={TABS} activeTab={tab} onChange={setTab} className="!pb-2" />

      <div className="grid lg:grid-cols-[1fr_auto] gap-5">
        <div className="space-y-4 min-w-0">
          {tab === 'layout' && (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field title="Paper roll width" hint="Used for the printer, the PDF and the preview.">
                  <select className={input} value={settings.paperWidth} onChange={(e) => update({ paperWidth: e.target.value as BusinessReceiptSettings['paperWidth'] })}>
                    <option value="58mm">58 mm (small, most Bluetooth printers)</option>
                    <option value="80mm">80 mm (wide, counter printers)</option>
                  </select>
                </Field>
                <Field title="Characters per line" hint="Change only if lines wrap or stop short on your printer's test page.">
                  <select className={input} value={settings.charsPerLine} onChange={(e) => update({ charsPerLine: Number(e.target.value) })}>
                    <option value={0}>Standard ({settings.paperWidth === '80mm' ? 48 : 32})</option>
                    <option value={32}>32</option>
                    <option value={42}>42</option>
                    <option value={48}>48</option>
                  </select>
                </Field>
                <Field title="Currency on totals">
                  <input className={input} value={settings.currencyFormat} onChange={(e) => update({ currencyFormat: e.target.value })} placeholder="KSh" />
                </Field>
                <Field title="Receipt number">
                  <div className="flex gap-2">
                    <input
                      className={`${input} w-24 uppercase`}
                      value={settings.receiptPrefix}
                      onChange={(e) => update({ receiptPrefix: e.target.value.toUpperCase() })}
                      placeholder="RCT"
                      aria-label="Receipt number prefix"
                    />
                    <select
                      className={input}
                      value={settings.receiptNumberFormat}
                      onChange={(e) => update({ receiptNumberFormat: e.target.value as BusinessReceiptSettings['receiptNumberFormat'] })}
                      aria-label="Receipt number format"
                    >
                      <option value="PREFIX-YYYY-INCREMENT">Prefix-Year-ID</option>
                      <option value="PREFIX-INCREMENT">Prefix-ID</option>
                      <option value="INCREMENT">ID only</option>
                    </select>
                  </div>
                </Field>
                <Field title="Date format">
                  <select className={input} value={settings.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as BusinessReceiptSettings['dateFormat'] })}>
                    <option value="DD/MM/YYYY">24/12/2026</option>
                    <option value="MM/DD/YYYY">12/24/2026</option>
                    <option value="YYYY-MM-DD">2026-12-24</option>
                    <option value="medium">24 Dec 2026</option>
                  </select>
                </Field>
                <Field title="Time format">
                  <select className={input} value={settings.timeFormat} onChange={(e) => update({ timeFormat: e.target.value as '12h' | '24h' })}>
                    <option value="24h">16:35</option>
                    <option value="12h">4:35 PM</option>
                  </select>
                </Field>
              </div>
              <p className="text-xs text-app-text-muted">
                VAT on receipts follows the business tax setting ({settings.isTaxEnabled ? `${settings.taxPercentage}%` : 'off'}).
              </p>
            </>
          )}

          {tab === 'shop' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field title="Name on receipt">
                <input className={input} value={settings.businessName} onChange={(e) => update({ businessName: e.target.value })} />
              </Field>
              <Field title="Phone">
                <input className={input} value={settings.phone} onChange={(e) => update({ phone: e.target.value })} inputMode="tel" />
              </Field>
              <div className="sm:col-span-2">
                <Field title="Address">
                  <input className={input} value={settings.address} onChange={(e) => update({ address: e.target.value })} />
                </Field>
              </div>
              <Field title="Email">
                <input className={input} value={settings.email} onChange={(e) => update({ email: e.target.value })} inputMode="email" />
              </Field>
              <Field title="Website">
                <input className={input} value={settings.website} onChange={(e) => update({ website: e.target.value })} />
              </Field>
              <Field title="KRA PIN" hint="Printed as text. A KRA-verified section appears only when KRA eTIMS signs the sale.">
                <input className={`${input} uppercase font-mono`} value={settings.pinNumber} onChange={(e) => update({ pinNumber: e.target.value.toUpperCase() })} placeholder="P051234567X" />
              </Field>
              <Field title="Business registration no.">
                <input className={input} value={settings.registrationNumber} onChange={(e) => update({ registrationNumber: e.target.value })} />
              </Field>
              <p className="sm:col-span-2 text-xs text-app-text-muted">Empty fields are left off the receipt.</p>
            </div>
          )}

          {tab === 'messages' && (
            <div className="space-y-3">
              <Field title="Line under the shop name">
                <input className={input} value={settings.headerMessage} onChange={(e) => update({ headerMessage: e.target.value })} />
              </Field>
              <Field title="Line after the totals" hint="Printed after the payment details, before the codes.">
                <input className={input} value={settings.footerMessage} onChange={(e) => update({ footerMessage: e.target.value })} />
              </Field>
              <Field title="Returns policy" hint="Second-last on the receipt, in italics.">
                <textarea rows={2} className={input} value={settings.returnPolicy} onChange={(e) => update({ returnPolicy: e.target.value })} />
              </Field>
              <Field title="Thank-you line" hint="The last line, in green (black on thermal paper).">
                <input className={input} value={settings.thankYouMessage} onChange={(e) => update({ thankYouMessage: e.target.value })} />
              </Field>
            </div>
          )}

          {tab === 'codes' && (
            <div className="space-y-4">
              <Switch
                checked={settings.showBarcode}
                onChange={(v) => update({ showBarcode: v })}
                label="Receipt barcode"
                description="A Code 128 barcode of the receipt ID, for looking the sale up later."
              />
              <Field title="Extra QR code" hint="The KRA verification QR is added by itself to sales KRA has signed.">
                <select className={input} value={settings.extraQr} onChange={(e) => update({ extraQr: e.target.value as ExtraQrOption })}>
                  <option value="none">None</option>
                  <option value="whatsapp_chat" disabled={!settings.phone}>WhatsApp chat with the shop{settings.phone ? '' : ' (add a phone first)'}</option>
                  <option value="business_website" disabled={!settings.website}>Shop website{settings.website ? '' : ' (add a website first)'}</option>
                  <option value="google_review" disabled={!settings.businessName}>Google review</option>
                  <option value="custom_url">Your own link</option>
                </select>
              </Field>
              {settings.extraQr === 'custom_url' && (
                <Field title="Link for the QR code">
                  <input className={input} value={settings.customQrUrl} onChange={(e) => update({ customQrUrl: e.target.value })} placeholder="https://" />
                </Field>
              )}
            </div>
          )}

          {tab === 'printers' && <PrintersTab settings={settings} update={update} />}

          {tab === 'kra' && activeBusinessId && <KraTab businessId={activeBusinessId} canConnect={canConnectKra} />}

          {tab !== 'kra' && (
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
            >
              {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />} Save receipt settings
            </button>
          )}
        </div>

        {tab !== 'kra' && tab !== 'printers' && (
          <div className="lg:w-[20rem]">
            <p className={label}>{previewLines ? 'Preview with your latest sale' : 'Preview'}</p>
            {previewLines ? (
              <div className="bg-app-bg rounded-xl p-3 max-h-[32rem] overflow-y-auto">
                <ReceiptPaper lines={previewLines} columns={columnsFor(settings)} paperWidth={settings.paperWidth} />
              </div>
            ) : (
              <p className="text-xs text-app-text-muted">Make a sale to see a preview here.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PrintersTab({ settings, update }: { settings: BusinessReceiptSettings; update: (p: Partial<BusinessReceiptSettings>) => void }) {
  const { showToast } = useAppStore();
  const [prefs, setPrefs] = useState<DevicePrinterPrefs>(() => printerService.getPrefs());
  const [testing, setTesting] = useState(false);
  const support = printerService.support();

  useEffect(() => printerService.onPrefsChange(setPrefs), []);

  const runTest = async (printer: PrinterTarget) => {
    await ReceiptService.printTest(settings, printer);
    setTesting(false);
    showToast('Printed', `Test page sent to ${printer.name}. Check that the number line fills the paper.`, undefined, 'success');
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-medium text-app-text">Printers on this device</p>
          <button
            type="button"
            onClick={() => setTesting(true)}
            disabled={!printerService.canPrint()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-bg text-sm font-medium disabled:opacity-50 cursor-pointer"
          >
            <Printer size={14} /> Find printer & print test page
          </button>
        </div>
        {!printerService.canPrint() && <p className="text-xs text-app-text-muted">{support.reason}</p>}
        {printerService.canPrint() && prefs.printers.length === 0 && (
          <p className="text-xs text-app-text-muted">
            None yet. Switch the printer on and search; {support.bluetooth ? 'Bluetooth printers nearby and ' : ''}Wi-Fi printers on this network are found
            automatically. A printer is remembered after it prints.
          </p>
        )}
        <ul className="space-y-1.5">
          {prefs.printers.map((p) => {
            const Icon = p.kind === 'bluetooth' ? Bluetooth : Wifi;
            const isDefault = prefs.defaultId === p.id;
            return (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-app-bg">
                <Icon size={16} className="text-amber-500 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{p.name}</span>
                  <span className="block text-xs text-app-text-muted truncate">
                    {p.kind === 'network' ? `${p.address}:${p.port ?? 9100}` : p.address}
                    {isDefault ? ' · chosen first' : ''}
                  </span>
                </span>
                {!isDefault && (
                  <button type="button" onClick={() => printerService.savePrefs({ defaultId: p.id })} className="p-2 rounded-lg hover:bg-app-card cursor-pointer" aria-label={`Choose ${p.name} first`}>
                    <Star size={15} />
                  </button>
                )}
                <button type="button" onClick={() => printerService.forget(p.id)} className="p-2 rounded-lg hover:bg-app-card text-red-500 cursor-pointer" aria-label={`Forget ${p.name}`}>
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-app-text-muted">You still confirm the printer every time you print.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field title="Copies per receipt">
          <select className={input} value={prefs.copies} onChange={(e) => printerService.savePrefs({ copies: Number(e.target.value) })}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Switch checked={prefs.autoCut} onChange={(v) => printerService.savePrefs({ autoCut: v })} label="Cut the paper after printing" description="Turn off for printers without a cutter if they print a stray character." />

      <div className="border-t border-app-border/60 pt-4 space-y-4">
        <p className="text-xs text-app-text-muted">These two apply to every till in the business (save below):</p>
        <Switch
          checked={settings.autoPrint}
          onChange={(v) => update({ autoPrint: v })}
          label="Print after every sale"
          description="Opens the receipt and the printer choice as soon as a sale is saved."
        />
        <Switch
          checked={settings.openCashDrawer}
          onChange={(v) => update({ openCashDrawer: v })}
          label="Open the cash drawer on cash sales"
          description="For drawers plugged into the receipt printer."
        />
      </div>

      <PrinterPicker open={testing} actionLabel="Print test page" onCancel={() => setTesting(false)} onConfirm={runTest} />
    </div>
  );
}

function KraTab({ businessId, canConnect }: { businessId: string; canConnect: boolean }) {
  const { showToast } = useAppStore();
  const { status, refresh } = useKraStatus(businessId);
  const current = status?.settings;
  const [form, setForm] = useState<Pick<KraSettings, 'environment' | 'pin' | 'branchId' | 'deviceSerial' | 'itemClassCode' | 'noVatTaxType'>>({
    environment: 'sandbox',
    pin: '',
    branchId: '00',
    deviceSerial: '',
    itemClassCode: '',
    noVatTaxType: 'D',
  });
  const [busy, setBusy] = useState<null | 'connect' | 'disconnect'>(null);

  useEffect(() => {
    if (current) {
      setForm({
        environment: current.environment,
        pin: current.pin,
        branchId: current.branchId,
        deviceSerial: current.deviceSerial,
        itemClassCode: current.itemClassCode,
        noVatTaxType: current.noVatTaxType,
      });
    }
  }, [current?.pin, current?.deviceSerial, current?.environment]);

  const connect = async () => {
    setBusy('connect');
    try {
      await kraService.connect(businessId, { ...form, pin: form.pin.trim().toUpperCase(), deviceSerial: form.deviceSerial.trim(), itemClassCode: form.itemClassCode.trim() });
      showToast('KRA eTIMS', 'Connected. New sales will be sent to KRA and their receipts will carry the KRA section.', undefined, 'success');
    } catch (err) {
      showToast('KRA eTIMS', toUserMessage(err, 'KRA did not accept these details.'), undefined, 'error');
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await kraService.disconnect(businessId);
      showToast('KRA eTIMS', 'Disconnected. Receipts no longer show a KRA section.', undefined, 'success');
    } catch (err) {
      showToast('KRA eTIMS', toUserMessage(err, 'Could not disconnect.'), undefined, 'error');
    } finally {
      setBusy(null);
    }
  };

  const connected = !!status?.connected;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div
        className={`p-3 rounded-xl text-sm flex gap-2.5 ${
          connected ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : current?.status === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-app-bg text-app-text-muted'
        }`}
      >
        {connected ? <ShieldCheck size={18} className="shrink-0" /> : <ShieldAlert size={18} className="shrink-0" />}
        <div>
          {!status && 'Checking…'}
          {status && connected && (
            <>
              <p className="font-medium">
                Connected to KRA {current?.environment === 'sandbox' ? 'test system (receipts are marked as not valid)' : 'eTIMS'}
              </p>
              <p className="text-xs mt-0.5">
                {current?.taxpayerName ? `${current.taxpayerName} · ` : ''}PIN {current?.pin} · branch {current?.branchId}
                {current?.sdcId ? ` · CU ${current.sdcId}` : ''}
              </p>
            </>
          )}
          {status && !connected && (
            <>
              <p className="font-medium">Not connected</p>
              <p className="text-xs mt-0.5">
                {current?.lastError || 'Receipts do not show a KRA section or KRA QR code until this business is connected and KRA signs each sale.'}
              </p>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-app-text-muted">
        Register for eTIMS (OSCU) on the KRA portal first. KRA gives you a device serial number for this system. Try the test system before going live.
      </p>

      <fieldset disabled={!canConnect || busy !== null} className="grid sm:grid-cols-2 gap-3 disabled:opacity-70">
        <Field title="System">
          <select className={input} value={form.environment} onChange={(e) => set({ environment: e.target.value as 'sandbox' | 'production' })}>
            <option value="sandbox">KRA test system (sandbox)</option>
            <option value="production">KRA live system</option>
          </select>
        </Field>
        <Field title="KRA PIN">
          <input className={`${input} uppercase font-mono`} value={form.pin} onChange={(e) => set({ pin: e.target.value.toUpperCase() })} placeholder="P051234567X" />
        </Field>
        <Field title="Branch ID" hint="00 for the head office.">
          <input className={`${input} font-mono`} value={form.branchId} onChange={(e) => set({ branchId: e.target.value.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" />
        </Field>
        <Field title="Device serial number" hint="From your eTIMS OSCU approval.">
          <input className={`${input} font-mono`} value={form.deviceSerial} onChange={(e) => set({ deviceSerial: e.target.value })} />
        </Field>
        <Field title="Item classification code" hint="KRA's code for what you sell (from the eTIMS item classification list).">
          <input className={`${input} font-mono`} value={form.itemClassCode} onChange={(e) => set({ itemClassCode: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" />
        </Field>
        <Field title="Sales without VAT are" hint="Used when the business tax setting is off, and for delivery fees.">
          <select className={input} value={form.noVatTaxType} onChange={(e) => set({ noVatTaxType: e.target.value as 'A' | 'C' | 'D' })}>
            <option value="D">Non-VAT (D)</option>
            <option value="A">Exempt (A)</option>
            <option value="C">Zero-rated (C)</option>
          </select>
        </Field>
      </fieldset>

      {!canConnect && <p className="text-xs text-app-text-muted">Only staff who manage integrations can change the KRA connection.</p>}

      {canConnect && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={connect}
            disabled={busy !== null || !form.pin || !form.deviceSerial || !form.itemClassCode}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 cursor-pointer"
          >
            {busy === 'connect' ? <RefreshCw size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {connected ? 'Save and check with KRA' : 'Connect to KRA'}
          </button>
          {connected && (
            <button
              type="button"
              onClick={disconnect}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-app-bg text-red-600 rounded-xl text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {busy === 'disconnect' ? <RefreshCw size={15} className="animate-spin" /> : <Unplug size={15} />} Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
