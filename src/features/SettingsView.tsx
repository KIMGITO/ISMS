import DataExportPanel from "../components/export/DataExportPanel";
import PaymentMethodsPanel from "../components/payments/PaymentMethodsPanel";
import { toUserMessage } from '../utils/userError';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Archive,
  Wallet,
  Bot,
  CloudUpload,
  MessageCircle,
  MessageSquareText,
} from 'lucide-react';
import { PasswordInput } from '../components/shared/PasswordInput';
import { NavSection, SectionNav } from '../components/shared/SectionNav';
import LogCleanupPanel from '../components/LogCleanupPanel';
import { isAdminRole } from '../services/logCleanup';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { hasRolePermission, PermissionCode } from '../utils/permissions';
import {
  Settings,
  Bell,
  Music,
  Shield,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Radio,
  HardDrive,
  Volume2,
  Save,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  LogOut,
  Database,
  Download,
  Cloud,
  Lock,
  Unlock,
  Check,
  X,
  ReceiptText,
  FileText,
  FileSpreadsheet,
  MapPin,
  Camera,
  Mic,
  Image,
  Bluetooth,
  Users,
  Calendar,
  Phone,
  Info,
  Smartphone,
  HelpCircle,
  Play,
  Send,
} from 'lucide-react';
import { useDevicePermission } from '../hooks/useDevicePermission';
import { PermissionType } from '../services/devicePermissionService';
import { configManager } from '../services/configManager';
import { motion, AnimatePresence } from 'motion/react';
import SearchableDropdown from '../components/SearchableDropdown';
import {
  normalizePhone,
  validatePhone,
  SUPPORTED_COUNTRIES,
} from '../utils/phoneUtils';
import ReceiptSettingsPanel, { InvoiceSettingsPanel } from '../components/receipts/ReceiptSettingsPanel';
import NotificationSettingsPanel from '../components/NotificationSettingsPanel';
import { SupabaseService } from '../services/supabaseService';
import { Switch } from '../components/shared/Switch';
import AiUsagePanel from '../components/assistant/AiUsagePanel';
import { hasModule } from '../stores/planStore';


interface SettingsViewProps {
  onRestartTour?: () => void;
}

type SectionId = 'payments' | 'receipts' | 'invoices' | 'ai' | 'backup' | 'records' | 'database' | 'device' | 'notifications' | 'help' | 'session';

const SETTINGS_SECTIONS: (NavSection<SectionId> & { permission?: PermissionCode })[] = [
  { id: 'payments', group: 'Shop', label: 'Payment methods', description: 'Switch Cash, M-Pesa, Card, Bank or Airtel on or off', icon: Wallet, keywords: 'methods cash mpesa card bank airtel turn off disable enable switch', permission: 'payments.configure' },
  { id: 'receipts', group: 'Shop', label: 'Receipts & printing', description: 'Paper, shop details, printers and KRA eTIMS', icon: ReceiptText, keywords: 'tax kra etims printer bluetooth wifi thermal qr barcode paper', permission: 'settings.tax' },
  { id: 'invoices', group: 'Shop', label: 'Invoices', description: 'Layout, texts, payment details and stamp', icon: FileText, keywords: 'invoice debt statement a5 stamp prefix number', permission: 'settings.tax' },
  { id: 'ai', group: 'Connections', label: 'AI assistant', description: 'Where your business uses AI', icon: Bot, keywords: 'assistant insights website messages on off', permission: 'settings.integrations' },
  { id: 'backup', group: 'Data', label: 'Export data', description: 'Download your records as a spreadsheet', icon: Download, keywords: 'export excel spreadsheet xlsx download backup report sheets', permission: 'settings.storage' },
  { id: 'records', group: 'Data', label: 'Old records', description: 'Clear old crash and backup logs', icon: Archive, keywords: 'logs history clear delete crash backup points earned space' },
  { id: 'device', group: 'This device', label: 'Device permissions', description: 'Camera, location, Bluetooth and more', icon: Smartphone, keywords: 'notifications storage microphone', permission: 'settings.view' },
  { id: 'notifications', group: 'Account', label: 'Notifications', description: 'Choose what you get notified about', icon: Bell, keywords: 'alerts mute pause push' },
  { id: 'help', group: 'Account', label: 'Help & tour', description: 'Restart the guided walkthrough', icon: HelpCircle, keywords: 'onboarding guide' },
  { id: 'session', group: 'Account', label: 'Sign out', description: 'End your session on this device', icon: LogOut, keywords: 'log out logout' },
];


export default function SettingsView({
  onRestartTour,
}: SettingsViewProps = {}) {
  const {
    showToast,
    currentEmployee,
    employees = [],
    logout,
    activeBusinessId,
  } = useAppStore();

  const currentRole = currentEmployee?.role || 'Staff';
  const isAdminOrOwner = currentRole === 'Admin' || currentRole === 'Owner';
  const isOwner = currentRole === 'Owner';
  // Centralized Device Permission Manager states
  const {
    statuses: permissionStatuses,
    loading: permissionLoading,
    request: requestDevicePermission,
    checkAll: checkAllDevicePermissions,
    openSettings: openDeviceSettings,
    isCapacitor,
    metadata: permissionMetadata,
  } = useDevicePermission();
  const [explainingPermission, setExplainingPermission] = useState<
    string | null
  >(null);
  const [showWebSettingsGuide, setShowWebSettingsGuide] = useState(false);

  // AI: the platform sets it up; the business switches it on or off per use (20261205001).
  const [aiConfig, setAiConfig] = useState<{ enabled: boolean; uses: Record<string, boolean>; system_prompt: string; own_key?: boolean }>({
    enabled: true,
    uses: {},
    system_prompt: '',
  });
  const [savingAi, setSavingAi] = useState(false);

  // ── AI settings (switches and instructions) ──
  useEffect(() => {
    if (!activeBusinessId) return;
    SupabaseService.callEdgeFunction('ai-config', { action: 'get', businessId: activeBusinessId })
      .then((data) => {
        if (data?.success && data.config) setAiConfig(data.config);
      })
      .catch((err) => console.error('Failed to load AI settings:', err));
  }, [activeBusinessId]);

  const handleSaveAiConfig = async () => {
    setSavingAi(true);
    try {
      const data = await SupabaseService.callEdgeFunction('ai-config', {
        action: 'save',
        businessId: activeBusinessId,
        config: aiConfig,
      });
      if (!data?.success) throw new Error(data?.error || 'Could not save.');
      setAiConfig(data.config);
      showToast('AI settings saved', 'Your AI switches are saved.', undefined, 'success');
    } catch (err: any) {
      showToast('Save failed', toUserMessage(err, 'Could not save. Try again.'), undefined, 'error');
    } finally {
      setSavingAi(false);
    }
  };

  // System States
  const [allowPush, setAllowPush] = useState(
    () => localStorage.getItem('kkm_pref_push') !== 'false',
  );
  const [allowSMS, setAllowSMS] = useState(
    () => localStorage.getItem('kkm_pref_sms') !== 'false',
  );
  const [passcodeType, setPasscodeType] = useState(
    () => localStorage.getItem('kkm_passcode_type') || '4',
  );
  const [ringtone, setRingtone] = useState(
    () => localStorage.getItem('kkm_pref_ringtone') || 'Bell',
  );
  const [offlineLimit, setOfflineLimit] = useState(
    () => localStorage.getItem('kkm_pref_offline_limit') || '12',
  );
  const [allowWorkerSettings, setAllowWorkerSettings] = useState(
    () =>
      localStorage.getItem('kkm_allow_worker_personal_settings') !== 'false',
  );
  const [deviceAccountId, setDeviceAccountId] = useState(
    () => localStorage.getItem('kkm_device_account_id') || 'emp-1',
  );

  const playChimeTone = (tone: string) => {
    /* Audio implementation */
  };
  const handleTestRingtone = (tone: string) => {
    /* Audio testing implementation */
  };

  const allowedSections = SETTINGS_SECTIONS.filter(
    (section) =>
      (!section.permission || hasRolePermission(currentRole, section.permission)) &&
      (section.id !== 'records' || isAdminRole(currentRole)) &&
      // The AI section only when the plan includes AI and insights.
      (section.id !== 'ai' || hasModule('ai')),
  );
  const [selectedSection, setActiveSection] = useState<SectionId | null>(null);
  const activeSection = selectedSection ?? allowedSections[0].id;

  // Save changes feedback
  const [saveSuccess, setSaveSuccess] = useState(false);

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg mb-2 text-app-text overflow-hidden font-sans">
      {/* Header */}
      <div className="bg-app-card border-b border-app-border p-4 flex items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
            <Settings size={18} />
          </div>
          <div className="select-none">
            <h2 className="text-sm font-semibold font-display text-app-text flex items-center gap-1.5">
              <span>Settings</span>
            </h2>
            <span className="text-[10px] text-app-text-muted font-medium">
              Your shop, connections, data and this device
            </span>
          </div>
        </div>
      </div>

      {/* Main Settings Panel */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 pb-nav font-semibold text-xs">
        {!isAdminOrOwner && !allowWorkerSettings ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 my-auto">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-3xl flex items-center justify-center mb-4 border border-red-500/15 ">
              <Shield size={28} />
            </div>
            <h3 className="text-sm font-semibold font-display text-app-text">
              You can't open these settings
            </h3>
            <p className="text-[10.5px] text-app-text-muted mt-2 max-w-xs leading-relaxed font-medium">
              The owner has turned off settings for staff on this device.
              Your role is <strong>{currentRole}</strong>.
            </p>

            {/* Always allow logging out and restarting tour, even if settings are locked */}
            <div className="mt-6 w-full max-w-xs p-4 bg-app-card border border-app-border rounded-2xl flex flex-col gap-3">
              <span className="text-[11px] font-semibold text-app-text-muted block text-left">
                Session & Help
              </span>
              <button
                onClick={() => {
                  onRestartTour?.();
                }}
                className="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-500 font-bold rounded-xl text-[10px] transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <HelpCircle size={13} />
                <span>Restart the tour</span>
              </button>
              <button
                onClick={() => {
                  logout();
                  showToast(
                    'Signed out',
                    'You are signed out.',
                  );
                }}
                className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-[10px] transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <LogOut size={13} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        ) : (
          <SectionNav<SectionId>
            sections={allowedSections}
            active={activeSection}
            onSelect={setActiveSection}
            searchPlaceholder="Search settings"
            collapseKey="kkm_settings_nav_collapsed"
          >
          <div className="flex flex-col gap-5">
            {/* Banner Alert if NOT Owner/Admin */}
            {!isAdminOrOwner && (
              <div className="p-3.5 bg-amber-500/5 border border-amber-500/15 rounded-2xl flex gap-2.5 items-start">
                <AlertTriangle
                  className="text-amber-500 shrink-0 mt-0.5"
                  size={16}
                />
                <div className="text-[10.5px]">
                  <span className="font-semibold text-amber-500 block">
                    Some settings are locked
                  </span>
                  <p className="text-app-text-muted mt-0.5 leading-relaxed font-medium">
                    You are signed in as <strong>{currentRole}</strong>. Only an owner can change
                    every setting.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-5 w-full">
              {/* 0. INTERACTIVE GUIDE TOUR SECTION */}

              {activeSection === 'receipts' && hasRolePermission(currentRole, 'settings.tax') && <ReceiptSettingsPanel />}
              {activeSection === 'invoices' && hasRolePermission(currentRole, 'settings.tax') && <InvoiceSettingsPanel />}

              {/* Centralized Device Hardware Permissions Card */}
              {activeSection === 'device' && hasRolePermission(currentRole, 'settings.view') && (
                <div
                  id="device-permissions-manager-card"
                  className="bg-app-card border border-app-border rounded-3xl p-4 sm:p-5 flex flex-col gap-3.5 shadow-sm min-w-0"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-app-border/40 pb-2.5 w-full min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ShieldCheck
                        size={16}
                        className="text-amber-500 shrink-0"
                      />
                      <h3
                        className="text-xs font-bold text-app-text font-display truncate"
                        title="Device permissions"
                      >
                        Device Permissions
                        
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={checkAllDevicePermissions}
                      title="Check again"
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 flex items-center gap-1 cursor-pointer transition shrink-0"
                    >
                      <RefreshCw size={11} className="shrink-0" />
                      <span className="lg:hidden xl:inline">Check again</span>
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                    What this device allows the app to use.
                  </p>

                  {/* Responsive Permissions Grid */}
                  {/* 1 column on mobile/lg (3-col dashboard), 2 columns on tablet/xl */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2.5 mt-0.5 w-full">
                    {Object.keys(permissionMetadata).map((key) => {
                      const type = key as PermissionType;
                      const meta = permissionMetadata[type];
                      const status = permissionStatuses[type];

                      const getPermissionIcon = (t: string) => {
                        switch (t) {
                          case 'camera':
                            return <Camera size={14} />;
                          case 'photos':
                            return <Image size={14} />;
                          case 'storage':
                            return <HardDrive size={14} />;
                          case 'microphone':
                            return <Mic size={14} />;
                          case 'location':
                            return <MapPin size={14} />;
                          case 'notifications':
                            return <Bell size={14} />;
                          case 'bluetooth':
                            return <Bluetooth size={14} />;
                          case 'contacts':
                            return <Users size={14} />;
                          case 'calendar':
                            return <Calendar size={14} />;
                          case 'phone':
                            return <Phone size={14} />;
                          default:
                            return <ShieldCheck size={14} />;
                        }
                      };

                      return (
                        <div
                          key={type}
                          className="flex items-center justify-between gap-2.5 p-2.5 bg-app-bg/50 border border-app-border/70 rounded-2xl shadow-xs hover:border-app-border transition min-w-0"
                        >
                          {/* Left: Icon & Description */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="p-1.5 bg-amber-500/10 rounded-xl text-amber-500 shrink-0">
                              {getPermissionIcon(type)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="font-bold text-[11px] text-app-text block leading-tight truncate">
                                {meta.label}
                              </span>
                              <span className="text-[11px] text-app-text-muted font-medium block leading-tight truncate mt-0.5">
                                {meta.description}
                              </span>
                            </div>
                          </div>

                          {/* Right: Status Action/Badge */}
                          <div className="shrink-0 flex items-center">
                            {status === 'granted' && (
                              <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-lg text-[11px] font-bold">
                                <Check size={11} className="shrink-0" />
                                <span>Granted</span>
                              </div>
                            )}

                            {status === 'prompt' && (
                              <button
                                type="button"
                                onClick={() => setExplainingPermission(type)}
                                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-xs whitespace-nowrap"
                              >
                                <span>Request</span>
                              </button>
                            )}

                            {status === 'denied' && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (isCapacitor) {
                                    openDeviceSettings();
                                  } else {
                                    setShowWebSettingsGuide(true);
                                  }
                                }}
                                className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-lg text-[11px] font-bold transition cursor-pointer flex items-center gap-1 whitespace-nowrap"
                              >
                                <span>Blocked</span>
                              </button>
                            )}

                            {status === 'unsupported' && (
                              <div className="bg-app-border/60 text-app-text-muted px-2 py-0.5 rounded-lg text-[11px] font-bold whitespace-nowrap">
                                N/A
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="contents">
              {/* AI: on/off per use. The platform runs it (provider, model, keys). */}
              {activeSection === 'ai' && hasRolePermission(currentRole, 'settings.integrations') && (
                <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-app-border/40 pb-2.5">
                    <MessageSquareText size={16} className="text-amber-500 shrink-0" />
                    <h3 className="text-xs font-bold text-app-text font-display truncate">AI</h3>
                  </div>
                  <p className="text-[11px] text-app-text-muted leading-relaxed">
                    The AI is set up and kept running for you. Choose where your business uses it.
                  </p>

                  <Switch
                    checked={aiConfig.enabled}
                    onChange={(v) => setAiConfig({ ...aiConfig, enabled: v })}
                    label="Use AI in this business"
                    description="Off stops every use below."
                  />

                  <div className={`flex flex-col divide-y divide-app-border/50 rounded-2xl border border-app-border px-3 ${aiConfig.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                    {([
                      ['assistant', 'Assistant in the app', 'Staff ask questions and prepare tasks in chat.'],
                      ['insights', 'Insights on Home and screens', 'Short advice on sales, money and stock.'],
                      ['website', 'Shop assistant on your website', 'Answers customers about products and prices.'],
                      ['messages', 'Writing messages and replies', 'Drafts customer messages and feedback replies.'],
                    ] as const).map(([key, label, description]) => (
                      <div key={key} className="py-3">
                        <Switch
                          checked={aiConfig.uses?.[key] !== false}
                          onChange={(v) => setAiConfig({ ...aiConfig, uses: { ...aiConfig.uses, [key]: v } })}
                          label={label}
                          description={description}
                        />
                      </div>
                    ))}
                  </div>

                  <AiUsagePanel businessId={activeBusinessId} />

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-app-text-muted block">Assistant instructions</label>
                    <span className="text-[11px] text-app-text-muted leading-tight">Facts and tone for your business, e.g. opening hours.</span>
                    <textarea
                      rows={2}
                      maxLength={4000}
                      value={aiConfig.system_prompt || ''}
                      onChange={(e) => setAiConfig({ ...aiConfig, system_prompt: e.target.value })}
                      placeholder="e.g. Answer briefly and in simple English. Our shop opens at 7 am."
                      className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-sans leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveAiConfig}
                      disabled={savingAi}
                      className="py-2 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-xs font-bold disabled:opacity-50"
                    >
                      {savingAi ? <RefreshCw size={14} className="animate-spin shrink-0" /> : <Save size={14} className="shrink-0" />}
                      {savingAi ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {activeSection === 'backup' && hasRolePermission(currentRole, 'settings.storage') && activeBusinessId && (
                <DataExportPanel businessId={activeBusinessId} />
              )}

              {activeSection === 'payments' && hasRolePermission(currentRole, 'payments.configure') && <PaymentMethodsPanel />}

              {/* Section Divider */}

              {activeSection === 'records' && isAdminRole(currentRole) && <LogCleanupPanel />}

            </div>
            {activeSection === 'notifications' && (
              <div className="bg-app-card border border-app-border rounded-3xl p-4 sm:p-5 shadow-sm min-w-0">
                <h3 className="text-sm font-bold text-app-text mb-1">Notifications</h3>
                <p className="text-xs text-app-text-muted mb-3">These apply to your account on every device.</p>
                <NotificationSettingsPanel />
              </div>
            )}

            {activeSection === 'help' && (
            <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm animate-fade-in">
              <div className="flex items-center gap-2 border-b border-app-border/40 pb-2.5">
                <HelpCircle size={16} className="text-amber-500" />
                <h3 className="text-xs font-semibold text-app-text font-display">
                  Guided tour
                </h3>
              </div>
              <div className="flex flex-col gap-3.5">
                <div>
                  <span className="font-semibold text-app-text text-[11px] block">
                    Show me around again
                  </span>
                  <span className="text-[11px] text-app-text-muted font-medium block mt-0.5">
                    Take the tour again.
                  </span>
                </div>
                <button
                  onClick={() => {
                    onRestartTour?.();
                    showToast(
                      'Tour started',
                      'The tour has started.',
                    );
                  }}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-[10px] transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Play size={12} />
                  <span>Restart the tour</span>
                </button>
              </div>
            </div>
            )}
            {/* 4. OPERATOR SESSION (Available to all) */}
            {activeSection === 'session' && (
            <div className="bg-red-500/5 border border-red-500/10 rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-red-500/10 pb-2.5">
                <LogOut size={16} className="text-red-500" />
                <h3 className="text-xs font-semibold text-red-500 font-display">
                  Sign out
                </h3>
              </div>
              <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                Sign out of your account on this device.
              </p>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    showToast(
                      'Signed out',
                      'You are signed out.',
                    );
                  }}
                  className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 text-[10px]"
                >
                  <LogOut size={13} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>)}
          </div>
          </SectionNav>
        )}
      </div>

      {/* Permission Pre-Request Explanation Dialog Modal */}
      <AnimatePresence>
        {explainingPermission &&
          (() => {
            const meta =
              permissionMetadata[explainingPermission as PermissionType];
            const getPermissionIcon = (t: string) => {
              switch (t) {
                case 'camera':
                  return <Camera size={20} />;
                case 'photos':
                  return <Image size={20} />;
                case 'storage':
                  return <HardDrive size={20} />;
                case 'microphone':
                  return <Mic size={20} />;
                case 'location':
                  return <MapPin size={20} />;
                case 'notifications':
                  return <Bell size={20} />;
                case 'bluetooth':
                  return <Bluetooth size={20} />;
                case 'contacts':
                  return <Users size={20} />;
                case 'calendar':
                  return <Calendar size={20} />;
                case 'phone':
                  return <Phone size={20} />;
                default:
                  return <ShieldCheck size={20} />;
              }
            };

            return (
              <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-app-card border border-app-border rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4 text-center relative animate-fade-in"
                >
                  <div className="mx-auto p-3.5 bg-amber-500/10 rounded-2xl text-amber-500 w-fit">
                    {getPermissionIcon(explainingPermission)}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-app-text font-display">
                      Allow {meta.label.toLowerCase()}
                    </h3>
                    <p className="text-[11px] text-app-text-muted leading-relaxed mt-2.5 font-medium px-2">
                      {meta.explanation}
                    </p>
                  </div>

                  <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-3 flex gap-2.5 text-left">
                    <Info
                      size={14}
                      className="text-amber-500 shrink-0 mt-0.5"
                    />
                    <p className="text-[11px] text-app-text-muted leading-relaxed font-medium">
                      You can turn this off any time.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setExplainingPermission(null)}
                      className="py-2.5 bg-app-bg border border-app-border hover:bg-app-border text-app-text font-semibold rounded-xl transition cursor-pointer text-[10px]"
                    >
                      Not now
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const type = explainingPermission as PermissionType;
                        setExplainingPermission(null);
                        const status = await requestDevicePermission(type);
                        if (status === 'denied' && !isCapacitor) {
                          setShowWebSettingsGuide(true);
                        }
                      }}
                      className="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl transition cursor-pointer text-[10px] shadow-md"
                    >
                      Allow Access
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()}
      </AnimatePresence>

      {/* Web Browser Settings Guide Modal */}
      <AnimatePresence>
        {showWebSettingsGuide && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-app-card border border-app-border rounded-3xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4 text-center"
            >
              <div className="mx-auto p-3.5 bg-red-500/10 rounded-2xl text-red-500 w-fit">
                <Lock size={20} />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-app-text font-display">
                  How to allow it again
                </h3>
                <p className="text-[10px] text-app-text-muted leading-relaxed mt-2 font-medium px-4">
                  Your browser blocked this. To allow it:
                </p>
              </div>

              <div className="flex flex-col gap-2.5 text-left bg-app-bg/60 p-4 border border-app-border rounded-2xl text-[10px] font-medium text-app-text-muted">
                <div className="flex gap-2">
                  <span className="font-semibold text-amber-500">1.</span>
                  <span>
                    Click the <strong>lock</strong> or{' '}
                    <strong>Tune</strong> settings icon in your browser's
                    address bar (top left of the screen, next to the web URL).
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold text-amber-500">2.</span>
                  <span>
                    Locate the blocked permission and change its dropdown status
                    toggle to <strong>Allow</strong>.
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold text-amber-500">3.</span>
                  <span>
                    Reload the page.
                  </span>
                </div>
              </div>

              {isCapacitor && (
                <button
                  type="button"
                  onClick={() => {
                    openDeviceSettings();
                    setShowWebSettingsGuide(false);
                  }}
                  className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-500 font-semibold rounded-xl text-[10px] transition cursor-pointer"
                >
                  Open phone settings
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowWebSettingsGuide(false);
                  checkAllDevicePermissions();
                }}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl transition cursor-pointer text-[10px] shadow-md"
              >
                Done, check again
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Success Banner */}
      {saveSuccess && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-4 py-2.5 rounded-full flex items-center gap-1.5 shadow-lg z-50 text-[10px] font-semibold animate-bounce">
          <CheckCircle2 size={13} />
          <span>Settings saved</span>
        </div>
      )}
    </div>
  );
}
