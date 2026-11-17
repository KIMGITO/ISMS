import React, { useEffect, useMemo, useState } from 'react';
import { ReceiptText, FileText, Save, Printer, Bluetooth, Wifi, Trash2, Star, RefreshCw, ShieldCheck, ShieldAlert, Unplug } from 'lucide-react';
import { Tabs } from '../TabOptions';
import { Switch } from '../shared/Switch';
import { SwipeRow } from '../shared/SwipeRow';
import { appDialog } from '../AppDialog';
import SearchableDropdown from '../SearchableDropdown';
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
import { kraService, KraSettings, useKraStatus, useVatPercent } from '../../services/kra/kraService';
import { ReceiptPaper } from './ReceiptPaper';
import { PrinterPicker } from './PrinterPicker';
import { InvoicePaper } from '../invoices/InvoicePaper';
import { InvoiceTexts, InvoicePeriodPreset } from '../../services/invoice/types';
import { contactsLine, getInvoiceTexts, saveInvoiceTexts, invoiceAccent, receiptClosing } from '../../services/invoice/invoiceSettings';
import { InvoiceLookControls } from '../invoices/InvoiceLookControls';
import { nextInvoiceNumber } from '../../services/invoice/invoiceData';
import { addDays, PERIOD_LABELS, periodFor, todayIso } from '../../services/invoice/invoiceDraft';
import type { Product, Transaction } from '../../types';

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
  // A dropdown has its own search box; inside a <label> a click there would re-open the trigger.
  const Tag = React.isValidElement(children) && children.type === Pick ? 'div' : 'label';
  return (
    <Tag className="block">
      <span className={label}>{title}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-app-text-muted">{hint}</span>}
    </Tag>
  );
}

/** A detail kept in Business settings: shown here, changed there. */
function BusinessValue({ title, value, fallback }: { title: string; value?: string; fallback?: string }) {
  const v = (value || '').trim();
  return (
    <div className="block min-w-0">
      <span className={label}>{title}</span>
      <div className="w-full bg-app-bg/60 text-app-text px-3 py-2 rounded-lg text-sm truncate" title={v || fallback || ''}>
        {v || fallback || <span className="text-app-text-muted">Not set</span>}
      </div>
      {!v && fallback && <span className="block mt-1 text-xs text-app-text-muted">From the old receipt settings until it is set in Business settings.</span>}
    </div>
  );
}

/** The app's dropdown for a fixed list of choices. A choice that isn't available yet says why and can't be picked. */
function Pick({ value, options, onChange }: { value: string; options: { id: string; label: string; sublabel?: string; disabled?: boolean }[]; onChange: (v: string) => void }) {
  return (
    <SearchableDropdown
      items={options.map((o) => ({ id: o.id, label: o.label, sublabel: o.sublabel }))}
      selectedValue={value}
      onChange={(v) => {
        const o = options.find((x) => x.id === v);
        if (o && !o.disabled) onChange(v);
      }}
      placeholder="Choose"
    />
  );
}

export default function ReceiptSettingsPanel() {
  const { showToast, currentEmployee } = useAppStore();
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);
  const receiptConfig = useBusinessStore((s) => s.integrationConfigs['receipt']);
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === s.activeBusinessId));
  const role = currentEmployee?.role || 'Staff';
  const canConnectKra = hasRolePermission(role, 'settings.integrations');

  const [tab, setTab] = useState<Tab>('layout');
  const [settings, setSettings] = useState<BusinessReceiptSettings>(() => ReceiptService.getSettings(activeBusinessId || ''));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (activeBusinessId && !dirty) setSettings(ReceiptService.getSettings(activeBusinessId));
  }, [activeBusinessId, receiptConfig, business?.address, business?.contactPhone, business?.contactEmail]);

  const update = (patch: Partial<BusinessReceiptSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  // Changes save by themselves shortly after you stop, and stay until changed again.
  const [savedOnce, setSavedOnce] = useState(false);
  const save = async (quiet = false) => {
    setSaving(true);
    try {
      await ReceiptService.saveSettings(settings);
      setDirty(false);
      setSavedOnce(true);
      if (!quiet) showToast('Saved', 'Receipt settings saved.', undefined, 'success');
    } catch (err) {
      showToast('Not saved', toUserMessage(err, 'Could not save the receipt settings.'), undefined, 'error');
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save(true), 900);
    return () => clearTimeout(t);
  }, [settings, dirty]);

  // The preview is an example sale, so it shows from the start and never needs real data.
  // It uses this business's tax rate so the totals look like a real receipt.
  const vatPct = useVatPercent(business);
  const sampleSale = useMemo<Transaction>(() => {
    const product = (id: string, name: string, price: number, unit: string) => ({ id, name, price, unit, stock: 0, category: '', sku: id.toUpperCase() } as unknown as Product);
    const items = [
      { product: product('sample-1', 'Fresh milk 500ml', 60, 'packet'), quantity: 4, discountPercentage: 0 },
      { product: product('sample-2', 'Bread 400g', 65, 'loaf'), quantity: 1, discountPercentage: 0 },
      { product: product('sample-3', 'Sugar 1kg', 180, 'packet'), quantity: 1, discountPercentage: 10 },
    ];
    const total = items.reduce((sum, i) => sum + i.product.price * i.quantity * (1 - i.discountPercentage / 100), 0);
    const rate = vatPct / 100;
    const tax = Math.round(total * rate * 100) / 100;
    return {
      id: '00000000-0000-4000-8000-000000001234',
      items,
      total,
      discount: 0,
      tax,
      finalTotal: total + tax,
      paymentMethod: 'M-Pesa',
      customerName: 'Example Customer',
      staffId: currentEmployee?.id || 'staff',
      staffName: currentEmployee?.name || 'Cashier',
      status: 'Synced',
      timestamp: new Date().toISOString(),
      referenceId: 'SAMPLE1234',
    };
  }, [vatPct, currentEmployee?.id, currentEmployee?.name]);
  const previewLines = useMemo(
    () => buildReceiptLines(buildReceiptContent(sampleSale, settings), settings),
    [sampleSale, settings],
  );

  return (
    <div className="bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 flex flex-col gap-4" id="receipt-engine-customization-settings">
      <div className="flex items-center gap-2">
        <ReceiptText size={18} className="text-amber-500" />
        <h3 className="text-sm font-semibold text-app-text">Receipts & printing</h3>
        <span className="ml-auto text-xs text-app-text-muted" aria-live="polite">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedOnce ? 'Saved' : 'Changes save automatically'}
        </span>
      </div>

      <Tabs<Tab> tabs={TABS} activeTab={tab} onChange={setTab} className="!pb-2" />

      <div className="grid lg:grid-cols-[1fr_auto] gap-5">
        <div className="space-y-4 min-w-0">
          {tab === 'layout' && (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field title="Paper roll width" hint="Used for the printer, the PDF and the preview.">
                  <Pick
                    value={settings.paperWidth}
                    onChange={(v) => update({ paperWidth: v as BusinessReceiptSettings['paperWidth'] })}
                    options={[
                      { id: '58mm', label: '58 mm', sublabel: 'Small, most Bluetooth printers' },
                      { id: '80mm', label: '80 mm', sublabel: 'Wide, counter printers' },
                    ]}
                  />
                </Field>
                <Field title="Characters per line" hint="Change only if lines wrap or stop short on your printer.">
                  <Pick
                    value={String(settings.charsPerLine)}
                    onChange={(v) => update({ charsPerLine: Number(v) })}
                    options={[
                      { id: '0', label: `Standard (${settings.paperWidth === '80mm' ? 48 : 32})` },
                      { id: '32', label: '32' },
                      { id: '42', label: '42' },
                      { id: '48', label: '48' },
                    ]}
                  />
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
                    <Pick
                      value={settings.receiptNumberFormat}
                      onChange={(v) => update({ receiptNumberFormat: v as BusinessReceiptSettings['receiptNumberFormat'] })}
                      options={[
                        { id: 'PREFIX-YYYY-INCREMENT', label: 'Prefix-Year-ID' },
                        { id: 'PREFIX-INCREMENT', label: 'Prefix-ID' },
                        { id: 'INCREMENT', label: 'ID only' },
                      ]}
                    />
                  </div>
                </Field>
                <Field title="Date format">
                  <Pick
                    value={settings.dateFormat}
                    onChange={(v) => update({ dateFormat: v as BusinessReceiptSettings['dateFormat'] })}
                    options={[
                      { id: 'DD/MM/YYYY', label: '24/12/2026' },
                      { id: 'MM/DD/YYYY', label: '12/24/2026' },
                      { id: 'YYYY-MM-DD', label: '2026-12-24' },
                      { id: 'medium', label: '24 Dec 2026' },
                    ]}
                  />
                </Field>
                <Field title="Time format">
                  <Pick
                    value={settings.timeFormat}
                    onChange={(v) => update({ timeFormat: v as '12h' | '24h' })}
                    options={[
                      { id: '24h', label: '16:35' },
                      { id: '12h', label: '4:35 PM' },
                    ]}
                  />
                </Field>
              </div>
              <p className="text-xs text-app-text-muted">
                {vatPct > 0 ? `VAT ${vatPct}% (eTIMS connected).` : 'No VAT: KRA eTIMS is not connected.'}
              </p>
            </>
          )}

          {tab === 'shop' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field title="Name on receipt">
                <input className={input} value={settings.businessName} onChange={(e) => update({ businessName: e.target.value })} />
              </Field>
              <BusinessValue title="Phone" value={business?.contactPhone} fallback={settings.phone} />
              <div className="sm:col-span-2">
                <BusinessValue title="Address" value={business?.address} fallback={settings.address} />
              </div>
              <BusinessValue title="Email" value={business?.contactEmail} fallback={settings.email} />
              <Field title="Website">
                <input className={input} value={settings.website} onChange={(e) => update({ website: e.target.value })} />
              </Field>
              <Field title="KRA PIN" hint="Printed as text. A KRA-verified section appears only when KRA eTIMS signs the sale.">
                <input className={`${input} uppercase font-mono`} value={settings.pinNumber} onChange={(e) => update({ pinNumber: e.target.value.toUpperCase() })} placeholder="P051234567X" />
              </Field>
              <Field title="Business registration no.">
                <input className={input} value={settings.registrationNumber} onChange={(e) => update({ registrationNumber: e.target.value })} />
              </Field>
              <p className="sm:col-span-2 text-xs text-app-text-muted">
                Phone, address and email come from Business settings and are used on receipts and invoices alike. Change them there. Empty fields are left off the receipt.
              </p>
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
              <Field title="Extra QR code" hint="The KRA QR code is added automatically to sales KRA has signed.">
                <Pick
                  value={settings.extraQr}
                  onChange={(v) => update({ extraQr: v as ExtraQrOption })}
                  options={[
                    { id: 'none', label: 'None' },
                    { id: 'whatsapp_chat', label: 'WhatsApp chat with the shop', disabled: !settings.phone, sublabel: settings.phone ? undefined : 'Add a phone first' },
                    { id: 'business_website', label: 'Shop website', disabled: !settings.website, sublabel: settings.website ? undefined : 'Add a website first' },
                    { id: 'google_review', label: 'Google review', disabled: !settings.businessName, sublabel: settings.businessName ? undefined : 'Add the shop name first' },
                    { id: 'custom_url', label: 'Your own link' },
                  ]}
                />
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
              onClick={() => save()}
              disabled={saving || !dirty}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
            >
              {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />} Save receipt settings
            </button>
          )}
        </div>

        {tab !== 'kra' && tab !== 'printers' && (
          <div className="min-w-0 lg:w-[28rem] xl:w-[34rem]">
            <p className={label}>Preview <span className="ml-1 px-1.5 py-0.5 rounded bg-app-bg text-[10px]">Example sale</span></p>
            <div className="bg-app-bg rounded-xl p-3 sm:p-4">
              <ReceiptPaper lines={previewLines} columns={columnsFor(settings)} paperWidth={settings.paperWidth} />
            </div>
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

  const forgetPrinter = async (printer: PrinterTarget) => {
    const ok = await appDialog.confirm({
      title: `Forget ${printer.name}?`,
      message: 'It is taken off this device. Search again to add it back.',
      confirmLabel: 'Forget',
      destructive: true,
    });
    if (ok) printerService.forget(printer.id);
  };

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
            title="Find a printer and print a test page"
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-bg text-sm font-medium disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Printer size={14} /> Test print
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
              <SwipeRow
                key={p.id}
                as="li"
                title={p.name}
                subtitle={p.kind === 'network' ? `${p.address}:${p.port ?? 9100}` : p.address}
                surfaceClassName="bg-app-bg"
                actions={[{ label: 'Forget', icon: <Trash2 size={18} />, tone: 'red', onClick: () => forgetPrinter(p) }]}
                more={[
                  { label: isDefault ? 'Chosen first' : 'Choose first', icon: <Star size={16} />, disabled: isDefault, onClick: () => printerService.savePrefs({ defaultId: p.id }) },
                  { label: 'Forget printer', icon: <Trash2 size={16} />, tone: 'red', onClick: () => forgetPrinter(p) },
                ]}
                className="rounded-xl"
                contentClassName="flex items-center gap-3 px-3 py-2"
              >
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
                <button type="button" onClick={() => forgetPrinter(p)} className="p-2 rounded-lg hover:bg-app-card text-red-500 cursor-pointer" aria-label={`Forget ${p.name}`}>
                  <Trash2 size={15} />
                </button>
              </SwipeRow>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-app-text-muted">You still confirm the printer every time you print.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field title="Copies per receipt">
          <Pick value={String(prefs.copies)} onChange={(v) => printerService.savePrefs({ copies: Number(v) })} options={[1, 2, 3].map((n) => ({ id: String(n), label: String(n) }))} />
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
          <Pick
            value={form.environment}
            onChange={(v) => set({ environment: v as 'sandbox' | 'production' })}
            options={[
              { id: 'sandbox', label: 'KRA test system (sandbox)' },
              { id: 'production', label: 'KRA live system' },
            ]}
          />
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
          <Pick
            value={form.noVatTaxType}
            onChange={(v) => set({ noVatTaxType: v as 'A' | 'C' | 'D' })}
            options={[
              { id: 'D', label: 'Non-VAT (D)' },
              { id: 'A', label: 'Exempt (A)' },
              { id: 'C', label: 'Zero-rated (C)' },
            ]}
          />
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

/** Defaults for customer invoices: wording, payment details, stamp and period. */
function InvoicesTab({ businessId, receipt }: { businessId: string; receipt: BusinessReceiptSettings }) {
  const { showToast } = useAppStore();
  const business = useBusinessStore((s) => s.businesses.find((b) => b.id === businessId));
  const saved = useBusinessStore((s) => s.integrationConfigs['invoice']);
  const [texts, setTexts] = useState<InvoiceTexts>(() => getInvoiceTexts(businessId));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [next, setNext] = useState<number | null>(null);

  useEffect(() => {
    if (!dirty) setTexts(getInvoiceTexts(businessId));
  }, [businessId, saved]);
  useEffect(() => {
    nextInvoiceNumber(businessId).then(setNext);
  }, [businessId]);

  const set = (patch: Partial<InvoiceTexts>) => {
    setTexts((t) => ({ ...t, ...patch }));
    setDirty(true);
  };
  // Saves by itself shortly after a change; new invoices start from these until changed.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save(true), 900);
    return () => clearTimeout(t);
  }, [texts, dirty]);
  const save = async (quiet = false) => {
    setSaving(true);
    try {
      await saveInvoiceTexts(texts);
      setDirty(false);
      if (!quiet) showToast('Saved', 'New invoices will use these settings.', undefined, 'success');
    } catch (err) {
      showToast('Not saved', toUserMessage(err, 'Could not save the invoice settings.'), undefined, 'error');
    } finally {
      setSaving(false);
    }
  };

  const prefix = texts.prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const nextLabel = next == null ? 'set when the first invoice is issued' : `${prefix ? `${prefix}-` : ''}${String(next).padStart(4, '0')}`;
  const footer = contactsLine(receipt);
  const fromReceipt = receiptClosing(receipt);

  // Preview only: one example line so the layout can be judged. Real invoices use real sales.
  const issuedAt = todayIso();
  const period = texts.defaultPeriod === 'all' || texts.defaultPeriod === 'custom' ? undefined : { ...periodFor(texts.defaultPeriod), includeEarlier: true };
  const sample = {
    issuedAt,
    dueAt: addDays(issuedAt, texts.dueDays),
    period,
    currency: receipt.currencyFormat || 'KSh',
    accent: invoiceAccent(business),
    logoUrl: business?.logoUrl,
    from: { name: receipt.businessName || business?.name || 'Your business', address: receipt.address, phone: receipt.phone, email: receipt.email },
    to: { name: 'Customer name', phone: 'Customer phone' },
    lines: [{ id: 'example', kind: 'product' as const, description: 'Example product', quantity: 2, unitPrice: 100, amount: 200 }],
    totals: { subtotal: 200, discount: 0, tax: 0, paid: 0, balance: 200 },
    texts: { ...texts, footer },
    ...fromReceipt,
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-4 min-w-0">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field title="Title"><input className={input} value={texts.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field title="Number prefix" >
            <input className={`${input} uppercase`} maxLength={8} value={texts.prefix} onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} />
          </Field>
          <Field title="Note under the title"><input className={input} value={texts.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          <Field title="Days to pay"><input type="number" min={0} max={365} className={input} value={texts.dueDays} onChange={(e) => set({ dueDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} /></Field>
          <Field title="Start new invoices with">
            <Pick
              value={texts.defaultPeriod}
              onChange={(v) => set({ defaultPeriod: v as InvoicePeriodPreset })}
              options={(['all', 'this_week', 'last_week', 'this_month', 'last_month'] as InvoicePeriodPreset[]).map((p) => ({ id: p, label: PERIOD_LABELS[p] }))}
            />
          </Field>
          <Field title="Thank-you line"><input className={input} value={texts.thankYou} onChange={(e) => set({ thankYou: e.target.value })} /></Field>
        </div>

        <Switch checked={texts.showPaymentDetails} onChange={(v) => set({ showPaymentDetails: v })} label="Show how to pay" description="Payment methods and details, such as your M-Pesa till or bank account." />
        {texts.showPaymentDetails && (
          <Field title="How to pay"><textarea rows={1} className={input} value={texts.paymentInstructions} onChange={(e) => set({ paymentInstructions: e.target.value })} placeholder={'M-Pesa Till 123456\nBank: …'} /></Field>
        )}

        <Switch checked={texts.showStamp} onChange={(v) => set({ showStamp: v })} label="Business stamp" description="A stamp with your business name and the invoice date." />
        {texts.showStamp && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field title="Stamp wording"><input className={input} maxLength={18} value={texts.stampLabel} onChange={(e) => set({ stampLabel: e.target.value })} placeholder="Authorised" /></Field>
            <Field title="Stamp colour">
              <div className="flex items-center gap-2">
                {['#1D4ED8', '#B91C1C', '#15803D', '#7C3AED', '#111827'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set({ stampColor: c })}
                    aria-label={`Stamp colour ${c}`}
                    aria-pressed={texts.stampColor === c}
                    className={`size-8 rounded-full cursor-pointer ring-offset-2 ring-offset-app-card ${texts.stampColor === c ? 'ring-2 ring-amber-500' : ''}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Field>
          </div>
        )}

        <InvoiceLookControls texts={texts} set={set} receipt={fromReceipt} hasLogo={!!business?.logoUrl} />

        <details className="rounded-xl bg-app-bg p-3">
          <summary className="text-sm font-medium cursor-pointer">Column and block labels</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field title="From"><input className={input} value={texts.fromLabel} onChange={(e) => set({ fromLabel: e.target.value })} /></Field>
            <Field title="To"><input className={input} value={texts.toLabel} onChange={(e) => set({ toLabel: e.target.value })} /></Field>
            <Field title="Product column"><input className={input} value={texts.productHeader} onChange={(e) => set({ productHeader: e.target.value })} /></Field>
            <Field title="Price column"><input className={input} value={texts.priceHeader} onChange={(e) => set({ priceHeader: e.target.value })} /></Field>
            <Field title="Quantity column"><input className={input} value={texts.qtyHeader} onChange={(e) => set({ qtyHeader: e.target.value })} /></Field>
            <Field title="Amount column"><input className={input} value={texts.amountHeader} onChange={(e) => set({ amountHeader: e.target.value })} /></Field>
          </div>
        </details>

        <button
          type="button"
          onClick={() => save()}
          disabled={saving || !dirty}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
        >
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />} {dirty ? 'Save now' : 'Saved'}
        </button>
        <p className="text-xs text-app-text-muted">Make an invoice from a customer's page in Loyalty → Invoices.</p>
      </div>

      <div className="min-w-0">
        <p className={label}>Preview <span className="ml-1 px-1.5 py-0.5 rounded bg-app-bg text-[10px]">Example line</span></p>
        <div className="bg-app-bg rounded-xl p-3 sm:p-4">
          <InvoicePaper doc={sample} onStampMove={(stampOffset) => set({ stampOffset })} />
        </div>
      </div>
    </div>
  );
}

/** Settings → Invoices: the layout and wording every new invoice starts with. */
export function InvoiceSettingsPanel() {
  const activeBusinessId = useBusinessStore((s) => s.activeBusinessId);
  const receiptConfig = useBusinessStore((s) => s.integrationConfigs['receipt']);
  const businesses = useBusinessStore((s) => s.businesses);
  const receipt = useMemo(() => ReceiptService.getSettings(activeBusinessId || ''), [activeBusinessId, receiptConfig, businesses]);
  if (!activeBusinessId) return null;
  return (
    <div className="bg-app-card border border-app-border rounded-2xl p-4 sm:p-5 flex flex-col gap-4" id="invoice-settings">
      <div className="flex items-center gap-2">
        <FileText size={18} className="text-amber-500" />
        <h3 className="text-sm font-semibold text-app-text">Invoices</h3>
        <span className="ml-auto text-xs text-app-text-muted">Changes save automatically</span>
      </div>
      <InvoicesTab businessId={activeBusinessId} receipt={receipt} />
    </div>
  );
}
