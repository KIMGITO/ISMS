import WhatsAppSettingsPanel from "../components/WhatsAppSettingsPanel";
import { toUserMessage } from '../utils/userError';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Archive,
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
  Cpu,
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
import { BackupConfig, BackupHistoryLog } from '../types';
import { useDevicePermission } from '../hooks/useDevicePermission';
import { PermissionType } from '../services/devicePermissionService';
import { configManager } from '../services/configManager';
import { motion, AnimatePresence } from 'motion/react';
import SearchableDropdown from '../components/SearchableDropdown';
import { AI_PROVIDERS, getAIProvider, isMaskedKey, aiConfigProblem, aiKeyWarning } from '../utils/aiProviders';
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

type SectionId = 'receipts' | 'invoices' | 'sms' | 'whatsapp' | 'ai' | 'backup' | 'records' | 'database' | 'device' | 'notifications' | 'help' | 'session';

const SETTINGS_SECTIONS: (NavSection<SectionId> & { permission?: PermissionCode })[] = [
  { id: 'receipts', group: 'Shop', label: 'Receipts & printing', description: 'Paper, shop details, printers and KRA eTIMS', icon: ReceiptText, keywords: 'tax kra etims printer bluetooth wifi thermal qr barcode paper', permission: 'settings.tax' },
  { id: 'invoices', group: 'Shop', label: 'Invoices', description: 'Layout, texts, payment details and stamp', icon: FileText, keywords: 'invoice debt statement a5 stamp prefix number', permission: 'settings.tax' },
  { id: 'sms', group: 'Connections', label: 'SMS', description: 'Text messages through Twilio', icon: MessageSquareText, keywords: 'twilio phone text', permission: 'settings.integrations' },
  { id: 'whatsapp', group: 'Connections', label: 'WhatsApp', description: 'Send messages through WhatsApp', icon: MessageCircle, keywords: 'meta cloud api', permission: 'settings.integrations' },
  { id: 'ai', group: 'Connections', label: 'AI assistant', description: 'Daily use and instructions', icon: Bot, keywords: 'gemini openai claude key model', permission: 'settings.integrations' },
  { id: 'backup', group: 'Data', label: 'Backups', description: 'Google Sheets backup and restore', icon: CloudUpload, keywords: 'sheets export import restore schedule', permission: 'settings.storage' },
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

  // AI Platform Config States
  const [aiConfig, setAiConfig] = useState({
    business_id: activeBusinessId || 'biz-1',
    provider: 'huggingface',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    temperature: 0.7,
    max_tokens: 2048,
    top_p: 0.95,
    top_k: 40,
    thinking_enabled: false,
    structured_output: false,
    system_prompt: '',
    enabled: true,
    api_key: '',
  });
  const [testingAi, setTestingAi] = useState(false);
  // The provider and masked key as last loaded/saved, so switching provider and back
  // restores the stored key instead of wiping it.
  const [savedAiKey, setSavedAiKey] = useState<{ provider: string; masked: string }>({ provider: 'huggingface', masked: '' });
  const [aiLiveModels, setAiLiveModels] = useState<string[]>([]);
  const [loadingAiModels, setLoadingAiModels] = useState(false);
  const [aiModelsError, setAiModelsError] = useState<string | null>(null);
  const [aiCustomModel, setAiCustomModel] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Twilio SMS Configuration States
  const [smsConfig, setSmsConfig] = useState({
    business_id: activeBusinessId || 'biz-1',
    provider: 'twilio' as 'twilio' | 'future_mock',
    default_country: '+254',
    account_sid: '',
    auth_token: '',
    messaging_service_sid: '',
    from_phone_number: '',
    owner_phone_number: '',
    enabled: false,
  });
  const [testingSms, setTestingSms] = useState(false);
  const [savingSms, setSavingSms] = useState(false);
  const [smsTestResult, setSmsTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Raw inputs for E.164 normalization tracking
  const [rawOwnerPhone, setRawOwnerPhone] = useState('');
  const [rawFromPhone, setRawFromPhone] = useState('');
  const [selectedCountryForOwner, setSelectedCountryForOwner] =
    useState('+254');
  const [selectedCountryForFrom, setSelectedCountryForFrom] = useState('+254');

  // Google Sheets Backup Configuration States & Actions
  const [sheetsConfig, setSheetsConfig] = useState<BackupConfig>({
    googleSheetUrl: '',
    googleServiceAccount: '',
    schedule: 'nightly_12am',
    enabled: false,
  });
  const [backupHistory, setBackupHistory] = useState<BackupHistoryLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [savingBackupConfig, setSavingBackupConfig] = useState(false);
  const [runningBackup, setRunningBackup] = useState(false);
  const [runningImport, setRunningImport] = useState(false);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [showSaJsonPass, setShowSaJsonPass] = useState(false);

  // ── BACKUP / STORAGE INTEGRATION EDGE CALLS ──
  const fetchBackupData = useCallback(async () => {
    if (!activeBusinessId || currentRole !== 'Owner') return;

    try {
      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'get',
        businessId: activeBusinessId,
        activeRole: currentRole,
      });
      if (data?.success && data.config) {
        setSheetsConfig(data.config);
      }
    } catch (err: any) {
      if (
        err?.code === 'SESSION_EXPIRED' ||
        err?.message?.includes('expired')
      ) {
        showToast(
          'Signed out',
          'Please log out and log back in to continue.',
          undefined,
          'error',
        );
      } else {
        console.error('Failed to load backup config:', err);
      }
    }

    setLoadingHistory(true);
    try {
      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'history',
        businessId: activeBusinessId,
        activeRole: currentRole,
      });
      if (data?.success && data.history) {
        setBackupHistory(data.history);
      }
    } catch (err: any) {
      if (
        err?.code === 'SESSION_EXPIRED' ||
        err?.message?.includes('expired')
      ) {
        showToast(
          'Signed out',
          'Please log out and log back in to continue.',
          undefined,
          'error',
        );
      } else {
        console.error('Failed to load backup history:', err);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [activeBusinessId, currentRole, showToast]);

  useEffect(() => {
    fetchBackupData();
  }, [fetchBackupData]);

  const handleSaveBackupConfig = async () => {
    setSavingBackupConfig(true);
    try {
      if (currentRole !== 'Owner') {
        throw new Error(
          'Only the owner can see or change these keys.',
        );
      }

      // --- NEW: SAFE FRONTEND VALIDATION ---
      // If the service account is coming from a textarea and isn't masked out yet
      if (
        sheetsConfig.googleServiceAccount &&
        !sheetsConfig.googleServiceAccount.includes('••••')
      ) {
        try {
          // Test if it's valid JSON
          const parsed = JSON.parse(sheetsConfig.googleServiceAccount);

          // Double check required Google parameters
          if (!parsed.client_email || !parsed.private_key) {
            throw new Error(
              'Missing "client_email" or "private_key" inside the JSON.',
            );
          }
        } catch (jsonErr: any) {
          throw new Error(
            "That Google service account file can't be read. Check it and try again.",
          );
        }
      }
      // -------------------------------------

      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'save',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: sheetsConfig, // Sent cleanly as an object containing strings
      });

      if (!data?.success)
        throw new Error(data?.error || 'Failed to update remote variables.');

      showToast(
        'Backup settings saved',
        'Your Google Sheets backup settings are saved.',
        undefined,
        'success',
      );
      fetchBackupData();
    } catch (err: any) {
      showToast(
        'Save failed',
        toUserMessage(err, 'Could not reach the server. Check your connection.'),
        undefined,
        'error',
      );
    } finally {
      setSavingBackupConfig(false);
    }
  };

  const handleRunBackup = async () => {
    setRunningBackup(true);
    showToast(
      'Backing up',
      'Copying your data to Google Sheets. This can take a minute.',
      undefined,
      'info',
    );

    try {
      // All data is fetched server-side by the edge function.
      // No local payload needed — the edge function reads directly from Supabase
      // using the business ID, ensuring the most up-to-date data is backed up.
      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'run',
        businessId: activeBusinessId,
        activeRole: currentRole,
      });

      if (data?.success) {
        showToast(
          'Backup done',
          data.message ||
            'Your data is in Google Sheets.',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast(
          'Backup failed',
          toUserMessage(data?.error, 'Failed to run backup.'),
          undefined,
          'error',
        );
        fetchBackupData();
      }
    } catch (err: any) {
      // Handle session expiry gracefully
      if (
        err?.code === 'SESSION_EXPIRED' ||
        err?.message?.includes('session')
      ) {
        showToast(
          'Signed out',
          'You were signed out. Sign in again and try again.',
          undefined,
          'error',
        );
      } else {
        showToast(
          'Backup failed',
          toUserMessage(err, 'Could not reach the server. Check your connection.'),
          undefined,
          'error',
        );
      }
    } finally {
      setRunningBackup(false);
    }
  };

  const handleRunImport = async () => {
    setRunningImport(true);
    showToast(
      'Importing',
      'Reading products and customers from Google Sheets.',
      undefined,
      'info',
    );
    try {
      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'import',
        businessId: activeBusinessId,
        activeRole: currentRole,
      });

      if (data?.success) {
        showToast(
          'Import done',
          'Products and customers were brought in from Google Sheets.',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast(
          'Import failed',
          toUserMessage(data?.error, 'Failed to run import.'),
          undefined,
          'error',
        );
        fetchBackupData();
      }
    } catch (err: any) {
      showToast(
        'Import failed',
        toUserMessage(err, 'Could not reach the server. Check your connection.'),
        undefined,
        'error',
      );
    } finally {
      setRunningImport(false);
    }
  };

  const handleRetryBackup = async (logId: string) => {
    setRetryingLogId(logId);
    showToast(
      'Trying again',
      'Running the backup again.',
      undefined,
      'info',
    );
    try {
      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'retry',
        businessId: activeBusinessId,
        activeRole: currentRole,
        logId,
      });

      if (data?.success) {
        showToast(
          'Backup done',
          'The backup worked this time.',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast(
          'Retry failed',
          toUserMessage(data?.error, 'Retry attempt failed.'),
          undefined,
          'error',
        );
        fetchBackupData();
      }
    } catch (err: any) {
      showToast(
        'Retry failed',
        toUserMessage(err, 'Could not reach the server. Check your connection.'),
        undefined,
        'error',
      );
    } finally {
      setRetryingLogId(null);
    }
  };

  // ── TWILIO SMS GATEWAY EDGE CALLS ──
  useEffect(() => {
    if (!activeBusinessId) return;

    const fetchSmsConfig = async () => {
      try {
        const data = await SupabaseService.callEdgeFunction('sms-config', {
          action: 'get',
          businessId: activeBusinessId,
          activeRole: currentRole,
        });

        if (data?.success && data.config) {
          const config = data.config;
          setSmsConfig(config);
          setRawOwnerPhone(config.owner_phone_number || '');
          setRawFromPhone(config.from_phone_number || '');

          const ownerNum = config.owner_phone_number || '';
          for (const c of SUPPORTED_COUNTRIES) {
            if (ownerNum.startsWith(c.code)) {
              setSelectedCountryForOwner(c.code);
              break;
            }
          }
          const fromNum = config.from_phone_number || '';
          for (const c of SUPPORTED_COUNTRIES) {
            if (fromNum.startsWith(c.code)) {
              setSelectedCountryForFrom(c.code);
              break;
            }
          }
        }
      } catch (err) {
        console.error(
          'Could not load SMS settings:',
          err,
        );
      }
    };

    fetchSmsConfig();
  }, [activeBusinessId, currentRole]);

  const handleSaveSmsConfig = async () => {
    setSavingSms(true);
    setSmsTestResult(null);
    try {
      if (currentRole !== 'Owner') {
        throw new Error(
          'Only the owner can see or change these keys.',
        );
      }
      const data = await SupabaseService.callEdgeFunction('sms-config', {
        action: 'save',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: smsConfig,
      });

      if (!data?.success)
        throw new Error(data?.error || 'Failed to sync parameters.');

      showToast(
        'SMS Settings Saved',
        'Your SMS settings are saved.',
        undefined,
        'success',
      );
    } catch (err: any) {
      showToast(
        'SMS Save Failed',
        toUserMessage(err, 'Could not reach the server. Check your connection.'),
        undefined,
        'error',
      );
    } finally {
      setSavingSms(false);
    }
  };

  const handleTestSmsConnection = async () => {
    setTestingSms(true);
    setSmsTestResult(null);
    try {
      // ✅ FIXED: Routes to 'sms-config' with action 'test' instead of non-existent 'sms-test'
      const data = await SupabaseService.callEdgeFunction('sms-config', {
        action: 'test',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: smsConfig,
      });

      if (data?.success) {
        setSmsTestResult({ success: true, message: data.message });
        showToast(
          'Test SMS sent',
          'A test message was sent. Check the phone.',
          undefined,
          'success',
        );
      } else {
        setSmsTestResult({
          success: false,
          message: data?.error || 'Delivery failed.',
        });
        showToast(
          'Test SMS failed',
          toUserMessage(data?.error, 'The test message was not sent.'),
          undefined,
          'error',
        );
      }
    } catch (err: any) {
      setSmsTestResult({
        success: false,
        message: toUserMessage(err, 'Could not reach the server. Check your connection.'),
      });
      showToast(
        'Test SMS failed',
        toUserMessage(err, 'Could not reach the server. Check your connection.'),
        undefined,
        'error',
      );
    } finally {
      setTestingSms(false);
    }
  };

  // ── COGNITIVE AI CONFIG EDGE CALLS ──
  useEffect(() => {
    if (!activeBusinessId) return;

    const fetchAiConfig = async () => {
      try {
        const data = await SupabaseService.callEdgeFunction('ai-config', {
          action: 'get',
          businessId: activeBusinessId,
          activeRole: currentRole,
        });
        if (data?.success && data.config) {
          setAiConfig(data.config);
          setSavedAiKey({ provider: getAIProvider(data.config.provider).id, masked: data.config.api_key || '' });
        }
      } catch (err) {
        console.error('Failed to load AI configuration:', err);
      }
    };

    fetchAiConfig();
  }, [activeBusinessId, currentRole]);

  const handleSaveAiConfig = async () => {
    setSavingAi(true);
    setAiTestResult(null);
    try {
      if (currentRole !== 'Owner') {
        throw new Error(
          'Only the owner can see or change these keys.',
        );
      }
      const problem = aiPlatform ? null : aiConfigProblem(aiConfig);
      if (problem) throw new Error(problem);
      const data = await SupabaseService.callEdgeFunction('ai-config', {
        action: 'save',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: aiConfig,
      });

      console.log('Response data', data);

      if (data?.success) {
        setAiConfig(data.config);
        setSavedAiKey({ provider: getAIProvider(data.config.provider).id, masked: data.config.api_key || '' });
        showToast(
          'Assistant settings saved',
          'Your assistant settings are saved.',
          undefined,
          'success',
        );
      } else {
        throw new Error(data?.error || 'Failed to update remote variables.');
      }
    } catch (err: any) {
      showToast(
        'Save failed',
        toUserMessage(err, 'Could not save. Try again.'),
        undefined,
        'error',
      );
    } finally {
      setSavingAi(false);
    }
  };

  const aiProviderInfo = getAIProvider(aiConfig.provider);
  /** The platform runs the AI: the business sets only its instructions and the switch. */
  const aiPlatform = (aiConfig as any).platform === true;
  const aiModelOptions = (() => {
    const curated = aiProviderInfo.models;
    const extra = aiLiveModels
      .filter((id) => !curated.some((m) => m.id === id))
      .map((id) => ({ id, label: id }));
    return [...curated, ...extra];
  })();

  const handleLoadAiModels = async () => {
    setLoadingAiModels(true);
    setAiModelsError(null);
    try {
      const data = await SupabaseService.callEdgeFunction('ai-config', {
        action: 'models',
        businessId: activeBusinessId,
        config: { provider: aiProviderInfo.id, api_key: aiConfig.api_key },
      });
      if (!data?.success) throw new Error(data?.error || 'Could not load the model list.');
      setAiLiveModels(Array.isArray(data.models) ? data.models : []);
    } catch (err: any) {
      setAiLiveModels([]);
      setAiModelsError(toUserMessage(err, 'Could not load the model list.'));
    } finally {
      setLoadingAiModels(false);
    }
  };

  const handleTestAiConnection = async () => {
    const problem = aiConfigProblem(aiConfig);
    if (problem) {
      setAiTestResult({ success: false, message: problem });
      return;
    }
    setTestingAi(true);
    setAiTestResult(null);
    try {
      // ✅ FIXED: Routes to 'ai-config' with action 'test' instead of non-existent 'ai-test'
      const data = await SupabaseService.callEdgeFunction('ai-config', {
        action: 'test',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: aiConfig,
      });

      if (data?.success) {
        setAiTestResult({ success: true, message: data.message });
        showToast(
          'Assistant works',
          'The assistant answered the test.',
          undefined,
          'success',
        );
      } else {
        setAiTestResult({
          success: false,
          message: data?.error || 'Connection failed.',
        });
        showToast(
          'Connection failed',
          toUserMessage(data?.error, 'The assistant did not answer the test.'),
          undefined,
          'error',
        );
      }
    } catch (err: any) {
      setAiTestResult({
        success: false,
        message: toUserMessage(err, 'Could not reach the server. Check your connection.'),
      });
      showToast(
        'Connection failed',
        toUserMessage(err, 'Could not reach the server. Check your connection.'),
        undefined,
        'error',
      );
    } finally {
      setTestingAi(false);
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
              {/* Enterprise AI Platform configuration card */}
              {activeSection === 'ai' && hasRolePermission(currentRole, 'settings.integrations') && (
                <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-app-border/40 pb-2.5 w-full min-w-0">
                    {/* Left: Icon & Title */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <MessageSquareText size={16} className="text-amber-500 shrink-0" />
                      <h3
                        className="text-xs font-bold text-app-text font-display truncate"
                        title="AI assistant"
                      >
                        AI assistant
                      </h3>
                    </div>

                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Enabled global toggle */}
                    <div className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <span className="font-semibold text-app-text text-[11px] block">
                          Turn on the assistant
                        </span>
                        <span className="text-[11px] text-app-text-muted font-medium block mt-0.5">
                          Chat help, reply drafts and feedback summaries
                        </span>
                      </div>
                      <Switch
                        checked={aiConfig.enabled}
                        onChange={() =>
                          setAiConfig({
                            ...aiConfig,
                            enabled: !aiConfig.enabled,
                          })}
                        ariaLabel="Enable the assistant"
                      />
                    </div>

                    <AiUsagePanel businessId={activeBusinessId} />

                    {/* Provider, key and model: only when the plan has the business bring its own key */}
                    {!aiPlatform && (<>
                    {/* Provider selection */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[11px] font-semibold text-app-text-muted block">
                        Assistant Provider
                      </label>
                      <p className="text-[11px] text-app-text-muted font-medium leading-relaxed mb-1">
                        Which AI service to use.
                      </p>

                      <SearchableDropdown
                        items={AI_PROVIDERS.map((p) => ({ id: p.id, label: p.label }))}
                        selectedValue={getAIProvider(aiConfig.provider).id}
                        onChange={(val) => {
                          const prov = getAIProvider(val);
                          // A stored key belongs to the provider it was saved for; going
                          // back to that provider brings its masked key back.
                          const key = prov.id === savedAiKey.provider ? savedAiKey.masked : '';
                          setAiConfig({ ...aiConfig, provider: prov.id, model: prov.defaultModel, api_key: key });
                          setAiLiveModels([]);
                          setAiModelsError(null);
                          setAiTestResult(null);
                        }}
                        placeholder="Select AI provider..."
                        searchPlaceholder="Search providers..."
                      />
                    </div>

                    {/* API key: optional for Hugging Face (server rotation), required for the rest */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-app-text-muted block">
                        API Key {aiProviderInfo.needsKey ? '*' : '(optional override)'}
                      </label>
                      <PasswordInput variant="app" label="" required={aiProviderInfo.needsKey} autoComplete="off" value={aiConfig.api_key} onChange={(api_key) => setAiConfig({ ...aiConfig, api_key: api_key.trim() })} placeholder={aiProviderInfo.needsKey ? `Paste your ${aiProviderInfo.label} key` : 'Leave empty to use the server keys'} />
                      <span className="text-[11px] text-app-text-muted leading-tight">
                        {aiProviderInfo.keyHelp}
                        {isMaskedKey(aiConfig.api_key) ? ' A key is saved; type a new one only to replace it.' : ''}
                      </span>
                      {aiKeyWarning(aiConfig) && (
                        <span className="text-[11px] text-amber-500 font-bold leading-tight">{aiKeyWarning(aiConfig)}</span>
                      )}
                    </div>

                    {/* Model: chosen from the provider's own list so an invalid name can't be sent */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[11px] font-semibold text-app-text-muted block">
                          Model
                        </label>
                        <button
                          type="button"
                          onClick={handleLoadAiModels}
                          disabled={loadingAiModels || (aiProviderInfo.needsKey && !aiConfig.api_key)}
                          className="text-[11px] font-bold text-amber-500 hover:underline disabled:opacity-40 disabled:no-underline flex items-center gap-1"
                        >
                          <RefreshCw size={10} className={loadingAiModels ? 'animate-spin' : ''} />
                          {aiLiveModels.length ? `Live list (${aiLiveModels.length})` : 'Load live list'}
                        </button>
                      </div>
                      <SearchableDropdown
                        items={[...aiModelOptions.map((m) => ({ id: m.id, label: m.label })), { id: '__custom__', label: 'Other (type the model name)…' }]}
                        selectedValue={aiModelOptions.some((m) => m.id === aiConfig.model) ? aiConfig.model : '__custom__'}
                        onChange={(v) => {
                          if (v === '__custom__') {
                            setAiCustomModel(true);
                          } else {
                            setAiCustomModel(false);
                            setAiConfig({ ...aiConfig, model: v });
                          }
                        }}
                        placeholder="Choose a model"
                        searchPlaceholder="Search models"
                      />
                      {(aiCustomModel || !aiModelOptions.some((m) => m.id === aiConfig.model)) && (
                        <input
                          type="text"
                          value={aiConfig.model}
                          onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value.trim() })}
                          placeholder={aiProviderInfo.defaultModel}
                          className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                        />
                      )}
                      {aiLiveModels.length > 0 && aiConfig.model && !aiLiveModels.includes(aiConfig.model) && (
                        <span className="text-[11px] text-amber-500 font-bold leading-tight">
                          {aiProviderInfo.label.replace(/ \(.*\)$/, '')} does not list "{aiConfig.model}" right now. Pick another model or run Test first.
                        </span>
                      )}
                      {aiModelsError && (
                        <span className="text-[11px] text-red-500 font-bold leading-tight">{aiModelsError}</span>
                      )}
                    </div>

                    </>)}

                    {/* System Prompt Instructions */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-app-text-muted block">
                        Assistant instructions
                      </label>
                      <span className="text-[11px] text-app-text-muted leading-tight">
                        How the assistant should answer for this business.
                      </span>
                      <textarea
                        rows={2}
                        value={aiConfig.system_prompt || ''}
                        onChange={(e) =>
                          setAiConfig({
                            ...aiConfig,
                            system_prompt: e.target.value,
                          })
                        }
                        placeholder="e.g. Answer briefly and in simple English. Our shop opens at 7 am."
                        className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-sans leading-relaxed"
                      />
                    </div>

                    {/* AI connection verification feedback results */}
                    {aiTestResult && (
                      <div
                        className={`p-3 rounded-2xl border text-[10px] leading-relaxed font-bold ${
                          aiTestResult.success
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500'
                            : 'bg-red-500/10 border-red-500/25 text-red-500'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 text-[10.5px]">
                          {aiTestResult.success ? (
                            <CheckCircle2 size={13} />
                          ) : (
                            <AlertTriangle size={13} />
                          )}
                          <span>
                            {aiTestResult.success
                              ? 'Test Succeeded'
                              : 'Test Failed'}
                          </span>
                        </div>
                        <p className="font-medium font-mono whitespace-pre-wrap">
                          {aiTestResult.message}
                        </p>
                      </div>
                    )}

                    {/* Testing & Saving action triggers */}
                    <div className="flex items-center justify-end gap-2 mt-1 w-full">
                      {/* Test AI Connection Button */}
                      {!aiPlatform && <button
                        type="button"
                        title="Test Connection"
                        disabled={testingAi || savingAi}
                        onClick={handleTestAiConnection}
                        className="flex-1 md:flex-none min-w-0 py-2 px-2.5 sm:px-3 md:p-2 bg-app-bg hover:bg-app-border border border-app-border hover:border-amber-500/25 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold disabled:opacity-50"
                      >
                        {testingAi ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Sending...
                            </span>
                          </>
                        ) : (
                          <>
                            <Cpu
                              size={14}
                              className="text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Test Connection
                            </span>
                          </>
                        )}
                      </button>}

                      {/* Save AI Settings Button */}
                      <button
                        type="button"
                        title="Save Assistant Settings"
                        onClick={handleSaveAiConfig}
                        disabled={testingAi || savingAi}
                        className="flex-1 md:flex-none min-w-0 py-2 px-2.5 sm:px-3 md:p-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold shadow-sm disabled:opacity-50"
                      >
                        {savingAi ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-slate-950 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Saving...
                            </span>
                          </>
                        ) : (
                          <>
                            <Save size={14} className="shrink-0" />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Save Settings
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Google Sheets Backup Integration Card */}
              {activeSection === 'backup' && hasRolePermission(currentRole, 'settings.storage') && (
                <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-app-border/40 pb-2.5 w-full min-w-0">
                    {/* Left: Icon & Title */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileSpreadsheet
                        size={16}
                        className="text-amber-500 shrink-0"
                      />
                      <h3
                        className="text-xs font-bold text-app-text font-display truncate"
                        title="Google Sheets Backup"
                      >
                        Google Sheets
                        <span className="hidden xl:inline"> Backup</span>
                      </h3>
                    </div>

                  </div>

                  <div className="flex flex-col gap-4">
                    <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                      Copies your data to your Google Sheet.
                    </p>

                    <div className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <span className="font-semibold text-app-text text-[11px] block">
                          Back up every night
                        </span>
                        <span className="text-[11px] text-app-text-muted font-medium block mt-0.5">
                          Runs on its own at the time you pick below
                        </span>
                      </div>
                      <Switch
                        checked={sheetsConfig.enabled}
                        onChange={() =>
                          setSheetsConfig((prev) => ({
                            ...prev,
                            enabled: !prev.enabled,
                          }))}
                        ariaLabel="Back up to Google Sheets"
                      />
                    </div>

                    {/* Google Sheets URL */}
                    <div className="flex flex-col gap-1 border-t border-app-border/30 pt-3">
                      <label className="text-[11px] font-semibold text-app-text-muted block">
                        Google Sheet URL
                      </label>
                      <input
                        type="text"
                        value={sheetsConfig.googleSheetUrl}
                        onChange={(e) =>
                          setSheetsConfig((prev) => ({
                            ...prev,
                            googleSheetUrl: e.target.value,
                          }))
                        }
                        placeholder="https://docs.google.com/spreadsheets/d/your-spreadsheet-id/edit"
                        className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                      />
                      <p className="text-[11px] text-app-text-muted leading-tight mt-1">
                        Share the sheet with the service account email as Editor.
                      </p>
                    </div>

                    {/* Google Service Account JSON */}
                    <div className="flex flex-col gap-1 border-t border-app-border/30 pt-3">
                      <label className="text-[11px] font-semibold text-app-text-muted flex justify-between">
                        <span>Google Service Account JSON</span>
                        <button
                          type="button"
                          onClick={() => setShowSaJsonPass(!showSaJsonPass)}
                          className="text-amber-500 hover:underline"
                        >
                          {showSaJsonPass ? 'Hide Keys' : 'Show / Edit JSON'}
                        </button>
                      </label>
                      <textarea
                        value={sheetsConfig.googleServiceAccount}
                        onChange={(e) =>
                          setSheetsConfig((prev) => ({
                            ...prev,
                            googleServiceAccount: e.target.value,
                          }))
                        }
                        placeholder={
                          showSaJsonPass
                            ? '{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----..."\n}'
                            : '••••••••••••••••'
                        }
                        disabled={!showSaJsonPass}
                        rows={5}
                        className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[10px] font-mono whitespace-pre"
                      />
                    </div>

                    {/* Backup Schedule & Status Info */}
                    <div className="grid  grid-cols-2 md:grid-cols-1 gap-3 border-t border-app-border/30 pt-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-app-text-muted block">
                          Backup Schedule
                        </label>
                        <SearchableDropdown
                          items={[
                            {
                              id: 'nightly_12am',
                              label: 'Every night at 12:00 AM',
                            },
                            {
                              id: 'nightly_3am',
                              label: 'Every night at 3:00 AM',
                            },
                            { id: 'every_12h', label: 'Every 12 hours' },
                          ]}
                          selectedValue={sheetsConfig.schedule}
                          onChange={(val) =>
                            setSheetsConfig((prev) => ({
                              ...prev,
                              schedule: val,
                            }))
                          }
                          placeholder="Select schedule..."
                        />
                      </div>

                      <div className="flex flex-col gap-1  border border-app-border/60 rounded-2xl p-2.5">
                        <div className="flex flex-col gap-0.5 mt-1 font-medium text-[10px]">
                          <div className="flex justify-between">
                            <span className="text-app-text-muted">
                              Last Backup:
                            </span>
                            <span className="text-app-text font-bold text-amber-500">
                              {(() => {
                                const lastSuccessLog = backupHistory.find(
                                  (l) => l.status === 'success',
                                );
                                return lastSuccessLog
                                  ? new Date(
                                      lastSuccessLog.timestamp,
                                    ).toLocaleDateString()
                                  : 'Never';
                              })()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-app-text-muted">
                              Connection:
                            </span>
                            <span
                              className={
                                sheetsConfig.googleSheetUrl &&
                                sheetsConfig.googleServiceAccount
                                  ? 'text-emerald-500 font-bold'
                                  : 'text-amber-500 font-bold'
                              }
                            >
                              {sheetsConfig.googleSheetUrl &&
                              sheetsConfig.googleServiceAccount
                                ? 'Connected'
                                : 'Not Set'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions buttons */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border/30 w-full">
                      {/* Import Button */}
                      <button
                        type="button"
                        title="Import Now"
                        disabled={
                          runningImport ||
                          savingBackupConfig ||
                          !sheetsConfig.googleSheetUrl
                        }
                        onClick={handleRunImport}
                        className="flex-1 md:flex-none min-w-0 py-2 px-2.5 sm:px-3 md:p-2 bg-app-bg hover:bg-app-border border border-app-border hover:border-amber-500/25 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold disabled:opacity-50"
                      >
                        {runningImport ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Importing...
                            </span>
                          </>
                        ) : (
                          <>
                            <Download
                              size={14}
                              className="text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Import Now
                            </span>
                          </>
                        )}
                      </button>

                      {/* Backup Button */}
                      <button
                        type="button"
                        title="Backup Now"
                        disabled={
                          runningBackup ||
                          savingBackupConfig ||
                          !sheetsConfig.googleSheetUrl
                        }
                        onClick={handleRunBackup}
                        className="flex-1 md:flex-none min-w-0 py-2 px-2.5 sm:px-3 md:p-2 bg-app-bg hover:bg-app-border border border-app-border hover:border-amber-500/25 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold disabled:opacity-50"
                      >
                        {runningBackup ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Executing...
                            </span>
                          </>
                        ) : (
                          <>
                            <Cloud
                              size={14}
                              className="text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Backup Now
                            </span>
                          </>
                        )}
                      </button>

                      {/* Save Button */}
                      <button
                        type="button"
                        title="Save Settings"
                        disabled={savingBackupConfig || runningBackup}
                        onClick={handleSaveBackupConfig}
                        className="flex-1 md:flex-none min-w-0 py-2 px-2.5 sm:px-3 md:p-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold shadow-sm disabled:opacity-50"
                      >
                        {savingBackupConfig ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-slate-950 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Saving...
                            </span>
                          </>
                        ) : (
                          <>
                            <Save size={14} className="shrink-0" />
                            <span className="truncate whitespace-nowrap md:hidden">
                              Save Settings
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'whatsapp' && hasRolePermission(currentRole, 'settings.integrations') && activeBusinessId && (
                <WhatsAppSettingsPanel businessId={activeBusinessId} />
              )}

              {/* Twilio SMS Platform configuration card */}
              {activeSection === 'sms' && hasRolePermission(currentRole, 'settings.integrations') && (
                <div
                  id="sms-gateway-config-card"
                  className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col md:col-span-2 lg:col-span-1 gap-4 shadow-sm"
                >
                  <div className="flex flex-col gap-2 border-b border-app-border/40 pb-2.5 w-full min-w-0">
                    {/* Row 1: Icon & Title */}
                    <div className="flex items-center gap-2 min-w-0">
                      <Smartphone
                        size={16}
                        className="text-amber-500 shrink-0"
                      />
                      <h3
                        className="text-xs font-bold text-app-text font-display truncate"
                        title="SMS Gateway Configuration"
                      >
                        SMS Gateway Configuration
                      </h3>
                    </div>

                    {/* Row 2: Status Badges */}
                    <div className="flex items-center justify-between gap-1.5 w-full">
                      {smsConfig.enabled ? (
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 animate-fade-in shrink-0">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Connected
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-500/10 border border-slate-500/20 text-app-text-muted shrink-0">
                          Offline
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Enabled global toggle */}
                    <div className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <span className="font-semibold text-app-text text-[11px] block">
                          Enable Twilio SMS Dispatches
                        </span>
                        <span className="text-[11px] text-app-text-muted font-medium block mt-0.5">
                          Receipts and alerts by SMS
                        </span>
                      </div>
                      <Switch
                        checked={smsConfig.enabled}
                        onChange={() =>
                          setSmsConfig({
                            ...smsConfig,
                            enabled: !smsConfig.enabled,
                          })}
                        ariaLabel="Enable SMS"
                      />
                    </div>

                    {/* Default Country Prefix Selector */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[11px] font-semibold text-app-text-muted block">
                        Default Country Prefix
                      </label>
                      <div className="flex flex-col items-center gap-2">
                        <SearchableDropdown
                          items={SUPPORTED_COUNTRIES.map((c) => ({
                            id: c.code,
                            label: `${c.flag} ${c.code} (${c.name})`,
                          }))}
                          selectedValue={smsConfig.default_country || '+254'}
                          onChange={(val) =>
                            setSmsConfig({
                              ...smsConfig,
                              default_country: val,
                            })
                          }
                          placeholder="Country prefix"
                          className="w-56 shrink-0"
                        />
                        <span className="text-[11px] text-app-text-muted font-medium">
                          Added to phone numbers typed without a country code.
                        </span>
                      </div>
                    </div>

                    {(
                      <>
                        {/* Account SID */}
                        <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                          <label className="text-[11px] font-semibold text-app-text-muted block">
                            Twilio Account SID
                          </label>
                          <input
                            type="text"
                            value={smsConfig.account_sid}
                            onChange={(e) =>
                              setSmsConfig({
                                ...smsConfig,
                                account_sid: e.target.value,
                              })
                            }
                            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                          />
                        </div>

                        {/* Auth Token */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex justify-between items-center">
                            <label className="text-[11px] font-semibold text-app-text-muted block">
                              Twilio Auth Token
                            </label>
                            </div>
                          <PasswordInput variant="app" label="" required={false} autoComplete="off" value={smsConfig.auth_token} onChange={(auth_token) => setSmsConfig({ ...smsConfig, auth_token })} placeholder="Enter secret auth token..." />
                        </div>

                        {/* Messaging SID or Sender Phone Number Selection */}
                        <div className="flex flex-col gap-2.5 border-t border-app-border/30 pt-3">
                          <label className="text-[11px] font-semibold text-app-text-muted block">
                            Who the message comes from
                          </label>
                          <p className="text-[11px] text-app-text-muted font-medium leading-relaxed mb-1">
                            Fill in one, from your Twilio account.
                          </p>

                          <div className="grid grid-cols-1  gap-3.5">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-semibold text-app-text">
                                Option A: Messaging Service SID
                              </span>
                              <input
                                type="text"
                                value={smsConfig.messaging_service_sid || ''}
                                onChange={(e) =>
                                  setSmsConfig({
                                    ...smsConfig,
                                    messaging_service_sid: e.target.value,
                                    from_phone_number: '',
                                  })
                                }
                                placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-semibold text-app-text">
                                Option B: Twilio Phone Number
                              </span>
                              <div className="grid  grid-cols-5 gap-1.5">
                                <SearchableDropdown
                                  items={SUPPORTED_COUNTRIES.map((c) => ({
                                    id: c.code,
                                    label: `${c.flag} ${c.code}`,
                                  }))}
                                  selectedValue={selectedCountryForFrom}
                                  onChange={(val) =>
                                    setSelectedCountryForFrom(val)
                                  }
                                  placeholder="Code"
                                  className="w-28 shrink-0 col-span-2"
                                />
                                <input
                                  type="text"
                                  value={rawFromPhone}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setRawFromPhone(val);
                                    const norm = normalizePhone(
                                      val,
                                      selectedCountryForFrom,
                                    );
                                    setSmsConfig((prev) => ({
                                      ...prev,
                                      from_phone_number: norm,
                                      messaging_service_sid: '',
                                    }));
                                  }}
                                  onBlur={() => {
                                    const norm = normalizePhone(
                                      rawFromPhone,
                                      selectedCountryForFrom,
                                    );
                                    setRawFromPhone(norm);
                                    setSmsConfig((prev) => ({
                                      ...prev,
                                      from_phone_number: norm,
                                      messaging_service_sid: '',
                                    }));
                                  }}
                                  placeholder="+1 555-0199"
                                  className="flex-1 col-span-3 bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Emergency Owner Phone Number Input with Auto Normalization */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[11px] font-semibold text-app-text-muted block">
                        Owner's phone for urgent alerts
                      </label>
                      <p className="text-[11px] text-app-text-muted font-medium leading-relaxed mb-1">
                        Gets urgent alerts by SMS.
                      </p>
                      <div className="grid grid-cols-5 gap-1.5">
                        <SearchableDropdown
                          items={SUPPORTED_COUNTRIES.map((c) => ({
                            id: c.code,
                            label: `${c.flag} ${c.code}`,
                          }))}
                          selectedValue={selectedCountryForOwner}
                          onChange={(val) => {
                            setSelectedCountryForOwner(val);
                            const norm = normalizePhone(rawOwnerPhone, val);
                            setSmsConfig((prev) => ({
                              ...prev,
                              owner_phone_number: norm,
                            }));
                          }}
                          placeholder="Code"
                          className="w-28 shrink-0 col-span-2"
                        />
                        <input
                          type="text"
                          value={rawOwnerPhone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRawOwnerPhone(val);
                            const norm = normalizePhone(
                              val,
                              selectedCountryForOwner,
                            );
                            setSmsConfig((prev) => ({
                              ...prev,
                              owner_phone_number: norm,
                            }));
                          }}
                          onBlur={() => {
                            const norm = normalizePhone(
                              rawOwnerPhone,
                              selectedCountryForOwner,
                            );
                            setRawOwnerPhone(norm);
                            setSmsConfig((prev) => ({
                              ...prev,
                              owner_phone_number: norm,
                            }));
                          }}
                          placeholder="e.g. 0712345678"
                          className="flex-1 col-span-3 bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-bold font-mono"
                        />
                      </div>
                      {smsConfig.owner_phone_number && (
                        <span className="text-[11px] text-emerald-500 font-mono font-bold mt-1 block">
                          Saved as{' '}
                          {smsConfig.owner_phone_number}
                        </span>
                      )}
                    </div>

                    {/* SMS Test Result Output */}
                    {smsTestResult && (
                      <div
                        className={`p-3 rounded-2xl border text-[10px] leading-relaxed font-bold ${
                          smsTestResult.success
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500'
                            : 'bg-red-500/10 border-red-500/25 text-red-500'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 text-[10.5px]">
                          {smsTestResult.success ? (
                            <CheckCircle2 size={13} />
                          ) : (
                            <AlertTriangle size={13} />
                          )}
                          <span>
                            {smsTestResult.success
                              ? 'SMS Dispatched'
                              : 'Not sent'}
                          </span>
                        </div>
                        <p className="font-medium font-mono">
                          {smsTestResult.message}
                        </p>
                      </div>
                    )}

                    {/* Actions Grid */}
                    <div className="flex items-center justify-end gap-2 mt-1 w-full">
                      {/* Test SMS Connection Button */}
                      <button
                        type="button"
                        title="Send Test SMS"
                        disabled={testingSms || savingSms}
                        onClick={handleTestSmsConnection}
                        className="flex-1 lg:flex-none min-w-0 py-2 px-2.5 sm:px-3 lg:p-2 bg-app-bg hover:bg-app-border border border-app-border hover:border-amber-500/25 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold disabled:opacity-50"
                      >
                        {testingSms ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap lg:hidden">
                              Sending...
                            </span>
                          </>
                        ) : (
                          <>
                            <Send
                              size={14}
                              className="text-amber-500 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap lg:hidden">
                              Send Test SMS
                            </span>
                          </>
                        )}
                      </button>

                      {/* Save SMS Settings Button */}
                      <button
                        type="button"
                        title="Save SMS Settings"
                        disabled={testingSms || savingSms}
                        onClick={handleSaveSmsConfig}
                        className="flex-1 lg:flex-none min-w-0 py-2 px-2.5 sm:px-3 lg:p-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer text-[11px] sm:text-xs font-bold shadow-sm disabled:opacity-50"
                      >
                        {savingSms ? (
                          <>
                            <RefreshCw
                              size={14}
                              className="animate-spin text-slate-950 shrink-0"
                            />
                            <span className="truncate whitespace-nowrap lg:hidden">
                              Saving...
                            </span>
                          </>
                        ) : (
                          <>
                            <Save size={14} className="shrink-0" />
                            <span className="truncate whitespace-nowrap lg:hidden">
                              Save Settings
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
