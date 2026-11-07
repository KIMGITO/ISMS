import WhatsAppSettingsPanel from "../components/WhatsAppSettingsPanel";
import { toUserMessage } from '../utils/userError';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  CloudUpload,
  MessageCircle,
  MessageSquareText,
} from 'lucide-react';
import { PasswordInput } from '../components/shared/PasswordInput';
import { NavSection, SectionNav } from '../components/shared/SectionNav';
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
  Brain,
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
import {
  normalizePhone,
  validatePhone,
  SUPPORTED_COUNTRIES,
} from '../utils/phoneUtils';
import ReceiptSettingsPanel from '../components/receipts/ReceiptSettingsPanel';
import NotificationSettingsPanel from '../components/NotificationSettingsPanel';
import { SupabaseService } from '../services/supabaseService';
import { Switch } from '../components/shared/Switch';


interface SettingsViewProps {
  onRestartTour?: () => void;
}

type SectionId = 'receipts' | 'sms' | 'whatsapp' | 'ai' | 'backup' | 'database' | 'device' | 'notifications' | 'help' | 'session';

const SETTINGS_SECTIONS: (NavSection<SectionId> & { permission?: PermissionCode })[] = [
  { id: 'receipts', group: 'Shop', label: 'Receipts & printing', description: 'Paper, shop details, printers and KRA eTIMS', icon: ReceiptText, keywords: 'tax kra etims printer bluetooth wifi thermal qr barcode paper', permission: 'settings.tax' },
  { id: 'sms', group: 'Connections', label: 'SMS', description: 'Text messages through Twilio', icon: MessageSquareText, keywords: 'twilio phone text', permission: 'settings.integrations' },
  { id: 'whatsapp', group: 'Connections', label: 'WhatsApp', description: 'Send messages through WhatsApp', icon: MessageCircle, keywords: 'meta cloud api', permission: 'settings.integrations' },
  { id: 'ai', group: 'Connections', label: 'AI assistant', description: 'Provider, model and instructions', icon: Bot, keywords: 'gemini openai claude key model', permission: 'settings.integrations' },
  { id: 'backup', group: 'Data', label: 'Backups', description: 'Google Sheets backup and restore', icon: CloudUpload, keywords: 'sheets export import restore schedule', permission: 'settings.storage' },
  { id: 'database', group: 'Data', label: 'Database', description: 'Supabase connection (developers)', icon: Database, keywords: 'supabase', permission: 'settings.integrations' },
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
  const [devClicks, setDevClicks] = useState(0);

  const handleSettingsTitleClick = () => {
    setDevClicks((c) => {
      const next = c + 1;
      if (next >= 5) {
        configManager.setEnvironment('Developer Mode');
        showToast(
          'Developer Mode',
          'Developer Mode Activated: Advanced Supabase connection parameters unlocked!',
        );
        return 0;
      }
      return next;
    });
  };

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
    model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
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
          'Session Expired',
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
          'Session Expired',
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
          'Access Denied: Only Owners can view or modify API credentials.',
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
            'That Google Service Account file is not valid JSON. Please check it and try again.',
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
        'Backup Settings Saved',
        'Google Sheets configuration stored securely.',
        undefined,
        'success',
      );
      fetchBackupData();
    } catch (err: any) {
      showToast(
        'Save Failed',
        toUserMessage(err, 'Network Error'),
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
      'Backup Initiated',
      'Fetching and exporting all data to Google Sheets — this may take a moment...',
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
          'Backup Complete ✓',
          data.message ||
            'All data tables written to Google Sheets successfully!',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast(
          'Backup Failed',
          data?.error || 'Failed to run backup.',
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
          'Session Expired',
          'Your login session has expired. Please log out and log back in, then try again.',
          undefined,
          'error',
        );
      } else {
        showToast(
          'Backup Failed',
          toUserMessage(err, 'Network Error'),
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
      'Import Initiated',
      'Reading products and customers data from Google Sheets...',
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
          'Import Success',
          'Successfully synchronized database tables with Google Sheets!',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast(
          'Import Failed',
          data?.error || 'Failed to run import.',
          undefined,
          'error',
        );
        fetchBackupData();
      }
    } catch (err: any) {
      showToast(
        'Import Failed',
        toUserMessage(err, 'Network Error'),
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
      'Retry Triggered',
      'Attempting to re-execute failed backup...',
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
          'Retry Success',
          'Backup succeeded on retry!',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast(
          'Retry Failed',
          data?.error || 'Retry attempt failed.',
          undefined,
          'error',
        );
        fetchBackupData();
      }
    } catch (err: any) {
      showToast(
        'Retry Failed',
        toUserMessage(err, 'Network Error'),
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
          'Failed to load SMS configuration from edge engine:',
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
          'Access Denied: Only Owners can view or modify API credentials.',
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
        'Twilio configuration stored securely in database.',
        undefined,
        'success',
      );
    } catch (err: any) {
      showToast(
        'SMS Save Failed',
        toUserMessage(err, 'Network Error'),
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
          'Test SMS Sent',
          'Verification message dispatched successfully!',
          undefined,
          'success',
        );
      } else {
        setSmsTestResult({
          success: false,
          message: data?.error || 'Delivery failed.',
        });
        showToast(
          'Test SMS Failed',
          data?.error || 'Twilio SMS test failed.',
          undefined,
          'error',
        );
      }
    } catch (err: any) {
      setSmsTestResult({
        success: false,
        message: toUserMessage(err, 'Network Error'),
      });
      showToast(
        'Test SMS Failed',
        toUserMessage(err, 'Network Error'),
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
          'Access Denied: Only Owners can view or modify API credentials.',
        );
      }
      const data = await SupabaseService.callEdgeFunction('ai-config', {
        action: 'save',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: aiConfig,
      });

      console.log('Response data', data);

      if (data?.success) {
        setAiConfig(data.config);
        showToast(
          'AI Config Saved',
          'AI configuration saved securely.',
          undefined,
          'success',
        );
      } else {
        throw new Error(data?.error || 'Failed to update remote variables.');
      }
    } catch (err: any) {
      showToast(
        'Save Failed',
        toUserMessage(err, 'Failed to save AI config'),
        undefined,
        'error',
      );
    } finally {
      setSavingAi(false);
    }
  };

  const handleTestAiConnection = async () => {
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
          'Connection Success',
          'AI Connection verified successfully!',
          undefined,
          'success',
        );
      } else {
        setAiTestResult({
          success: false,
          message: data?.error || 'Connection failed.',
        });
        showToast(
          'Connection Failed',
          data?.error || 'AI Connection test failed.',
          undefined,
          'error',
        );
      }
    } catch (err: any) {
      setAiTestResult({
        success: false,
        message: toUserMessage(err, 'Network Error'),
      });
      showToast(
        'Connection Failed',
        toUserMessage(err, 'Network Error'),
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
    () => localStorage.getItem('kkm_pref_ringtone') || 'Milk Bell',
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

  // Database & Supabase settings states
  const [supabaseUrl, setSupabaseUrl] = useState(
    () =>
      localStorage.getItem('kkm_supabase_url') ||
      'https://bvyzujgqyvaxqfzhwqnd.supabase.co',
  );
  const [supabaseKey, setSupabaseKey] = useState(
    () =>
      localStorage.getItem('kkm_supabase_key') ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  );
  const [dbHost, setDbHost] = useState(
    () =>
      localStorage.getItem('kkm_db_host') ||
      'aws-0-eu-central-1.pooler.supabase.com',
  );
  const [dbPort, setDbPort] = useState(
    () => localStorage.getItem('kkm_db_port') || '5432',
  );
  const [dbName, setDbName] = useState(
    () => localStorage.getItem('kkm_db_name') || 'postgres',
  );
  const [dbUser, setDbUser] = useState(
    () =>
      localStorage.getItem('kkm_db_user') || 'postgres.bvyzujgqyvaxqfzhwqnd',
  );
  const [dbPass, setDbPass] = useState(
    () => localStorage.getItem('kkm_db_pass') || 'kkm_milk_secure_2026',
  );
  const [dbSyncEnabled, setDbSyncEnabled] = useState(
    () => localStorage.getItem('kkm_db_sync_enabled') !== 'false',
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
      (section.id !== 'database' || configManager.getActiveEnvironment() === 'Developer Mode'),
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
          <div
            onClick={handleSettingsTitleClick}
            className="cursor-pointer select-none"
          >
            <h2 className="text-sm font-extrabold font-display text-app-text flex items-center gap-1.5">
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
            <h3 className="text-sm font-black font-display text-app-text uppercase tracking-wider">
              Access Policy Violation
            </h3>
            <p className="text-[10.5px] text-app-text-muted mt-2 max-w-xs leading-relaxed font-medium">
              Your operator account (<strong>{currentRole}</strong>) does not
              have clearance to adjust device preferences. The terminal
              administrator has disabled personal settings customization for
              staff on this device.
            </p>

            {/* Always allow logging out and restarting tour, even if settings are locked */}
            <div className="mt-6 w-full max-w-xs p-4 bg-app-card border border-app-border rounded-2xl flex flex-col gap-3">
              <span className="text-[9px] font-extrabold text-app-text-muted uppercase tracking-wider block text-left">
                Session & Help
              </span>
              <button
                onClick={() => {
                  onRestartTour?.();
                }}
                className="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-500 font-bold rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <HelpCircle size={13} />
                <span>Restart Onboarding Tour</span>
              </button>
              <button
                onClick={() => {
                  logout();
                  showToast(
                    'Logged Out',
                    'Operator session closed successfully.',
                  );
                }}
                className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <LogOut size={13} />
                <span>Log Out of Account</span>
              </button>
            </div>
          </div>
        ) : (
          <SectionNav<SectionId>
            sections={allowedSections}
            active={activeSection}
            onSelect={setActiveSection}
            searchPlaceholder="Search settings"
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
                  <span className="font-extrabold text-amber-500 block">
                    Staff Clearance Restriction
                  </span>
                  <p className="text-app-text-muted mt-0.5 leading-relaxed font-medium">
                    You are currently viewing settings as a{' '}
                    <strong>{currentRole}</strong>. Some administrative options
                    (such as custom offline buffers and global tax metrics) are
                    restricted. Switch roles or log in as an Owner to unlock
                    total master controls.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-5 w-full">
              {/* 0. INTERACTIVE GUIDE TOUR SECTION */}

              {activeSection === 'receipts' && hasRolePermission(currentRole, 'settings.tax') && <ReceiptSettingsPanel />}

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
                        title="Device Permissions Manager"
                      >
                        Device Permissions
                        <span className="hidden xl:inline"> Manager</span>
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={checkAllDevicePermissions}
                      title="Scan Sensors"
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 flex items-center gap-1 cursor-pointer transition shrink-0"
                    >
                      <RefreshCw size={11} className="shrink-0" />
                      <span className="lg:hidden xl:inline">Scan Sensors</span>
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                    Centralized dashboard managing hardware permissions for
                    cameras, location sensors, push notifications, and local
                    offline database persistent caches.
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
                              <span className="text-[9px] text-app-text-muted font-medium block leading-tight truncate mt-0.5">
                                {meta.description}
                              </span>
                            </div>
                          </div>

                          {/* Right: Status Action/Badge */}
                          <div className="shrink-0 flex items-center">
                            {status === 'granted' && (
                              <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-2 py-0.5 rounded-lg text-[9.5px] font-bold">
                                <Check size={11} className="shrink-0" />
                                <span>Granted</span>
                              </div>
                            )}

                            {status === 'prompt' && (
                              <button
                                type="button"
                                onClick={() => setExplainingPermission(type)}
                                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-[9.5px] font-bold transition cursor-pointer flex items-center gap-1 shadow-xs whitespace-nowrap"
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
                                className="px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-lg text-[9.5px] font-bold transition cursor-pointer flex items-center gap-1 whitespace-nowrap"
                              >
                                <span>Blocked</span>
                              </button>
                            )}

                            {status === 'unsupported' && (
                              <div className="bg-app-border/60 text-app-text-muted px-2 py-0.5 rounded-lg text-[9px] font-bold whitespace-nowrap">
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
                      <Brain size={16} className="text-amber-500 shrink-0" />
                      <h3
                        className="text-xs font-bold text-app-text font-display truncate"
                        title="Workspace Assistant Platform"
                      >
                        Workspace Assistant
                        <span className="hidden xl:inline"> Platform</span>
                      </h3>
                    </div>

                    {/* Right: Status Badge */}
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0 whitespace-nowrap">
                      Authorized
                      <span className="hidden xl:inline"> Access</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Enabled global toggle */}
                    <div className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <span className="font-extrabold text-app-text text-[11px] block">
                          Enable Smart Assistant Features
                        </span>
                        <span className="text-[9.5px] text-app-text-muted font-medium block mt-0.5">
                          Toggle assistant chat, automated reply, and customer
                          complaints analyzer
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

                    {/* Provider selection */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                        Assistant Provider
                      </label>
                      <p className="text-[9px] text-app-text-muted font-medium leading-relaxed mb-1">
                        Select the vendor to power this business's custom CRM
                        and operations assistant.
                      </p>

                      <SearchableDropdown
                        items={[
                          {
                            id: 'huggingface',
                            label:
                              'Hugging Face ( Recommended)',
                          },
                          { id: 'gemini', label: 'Google Gemini Platform' },
                          { id: 'openai', label: 'OpenAI GPT Engines' },
                          { id: 'anthropic', label: 'Anthropic Claude' },
                          { id: 'deepseek', label: 'DeepSeek AI' },
                          { id: 'groq', label: 'Groq Cloud Llama' },
                          { id: 'openrouter', label: 'OpenRouter Unified API' },
                        ]}
                        selectedValue={aiConfig.provider || 'huggingface'}
                        onChange={(val) => {
                          const prov = val;
                          let defaultModel = 'Qwen/Qwen2.5-Coder-32B-Instruct';

                          if (prov === 'huggingface')
                            defaultModel = 'Qwen/Qwen2.5-Coder-32B-Instruct';
                          else if (prov === 'gemini')
                            defaultModel = 'gemini-2.5-flash';
                          else if (prov === 'openai')
                            defaultModel = 'gpt-4o-mini';
                          else if (prov === 'anthropic')
                            defaultModel = 'claude-3-5-haiku-latest';
                          else if (prov === 'deepseek')
                            defaultModel = 'deepseek-chat';
                          else if (prov === 'groq')
                            defaultModel = 'llama-3.3-70b-versatile';
                          else if (prov === 'openrouter')
                            defaultModel = 'meta-llama/llama-3.3-70b-instruct';

                          setAiConfig({
                            ...aiConfig,
                            provider: prov,
                            model: defaultModel,
                          });
                        }}
                        placeholder="Select AI provider vendor..."
                        searchPlaceholder="Search providers..."
                      />
                    </div>

                    {/* API Key Input (Optional for Hugging Face, required for other providers) */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                          API Access Token / Key{' '}
                          {aiConfig.provider === 'huggingface'
                            ? '(Optional Override)'
                            : '*'}
                        </label>
                        </div>
                      <PasswordInput variant="app" label="" required={false} autoComplete="off" value={aiConfig.api_key} onChange={(api_key) => setAiConfig({ ...aiConfig, api_key })} placeholder={aiConfig.provider === 'huggingface' ? '' : 'Enter provider secret key...'} />
                    </div>

                    {/* Model input and quick selector badges */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                        Model Identifier
                      </label>
                      <input
                        type="text"
                        value={aiConfig.model}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, model: e.target.value })
                        }
                        placeholder="e.g. Qwen/Qwen2.5-Coder-32B-Instruct"
                        className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                      />

                      {/* Model suggestion tags */}
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(!aiConfig.provider ||
                          aiConfig.provider === 'huggingface') && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              Qwen2.5-Coder-32B
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'meta-llama/Llama-3.3-70B-Instruct',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              Llama-3.3-70B
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'mistralai/Mistral-7B-Instruct-v0.3',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              Mistral-7B-v0.3
                            </button>
                          </>
                        )}
                        {aiConfig.provider === 'gemini' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'gemini-3.5-flash',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              gemini-3.5-flash
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'gemini-3.1-flash-lite',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              gemini-3.1-flash-lite
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'gemini-2.5-flash',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              gemini-2.5-flash
                            </button>
                          </>
                        )}
                        {aiConfig.provider === 'openai' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'gpt-4o-mini',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              gpt-4o-mini
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({ ...aiConfig, model: 'gpt-4o' })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              gpt-4o
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({ ...aiConfig, model: 'o1-mini' })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              o1-mini
                            </button>
                          </>
                        )}
                        {aiConfig.provider === 'anthropic' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'claude-3-5-haiku-latest',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              claude-3-5-haiku
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'claude-3-5-sonnet-latest',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              claude-3-5-sonnet
                            </button>
                          </>
                        )}
                        {aiConfig.provider === 'deepseek' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'deepseek-chat',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              deepseek-chat
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'deepseek-reasoner',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              deepseek-reasoner
                            </button>
                          </>
                        )}
                        {aiConfig.provider === 'groq' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'llama-3.3-70b-versatile',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              llama-3.3-70b
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({
                                  ...aiConfig,
                                  model: 'gemma2-9b-it',
                                })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              gemma2-9b-it
                            </button>
                          </>
                        )}
                        {aiConfig.provider === 'ollama' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({ ...aiConfig, model: 'llama3' })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              llama3
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiConfig({ ...aiConfig, model: 'mistral' })
                              }
                              className="px-2 py-0.5 bg-app-bg border border-app-border rounded-md text-[8px] font-bold text-app-text-muted hover:border-amber-500/40"
                            >
                              mistral
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Advanced hyper-parameters row */}
                    <div className="grid grid-cols-2 gap-3.5 border-t border-app-border/30 pt-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                          Temperature ({aiConfig.temperature})
                        </label>
                        <input
                          type="range"
                          min="0.0"
                          max="2.0"
                          step="0.1"
                          value={aiConfig.temperature}
                          onChange={(e) =>
                            setAiConfig({
                              ...aiConfig,
                              temperature: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-amber-500 bg-app-bg h-1.5 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-[8px] text-app-text-muted leading-tight block mt-0.5">
                          Controls response randomness. Lower values (e.g. 0.2)
                          are precise and factual; higher values (e.g. 1.0+)
                          increase creativity and vocabulary diversity.
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                          Max Tokens
                        </label>
                        <input
                          type="number"
                          value={aiConfig.max_tokens}
                          onChange={(e) =>
                            setAiConfig({
                              ...aiConfig,
                              max_tokens: parseInt(e.target.value) || 1024,
                            })
                          }
                          className="w-full bg-app-bg text-app-text px-2.5 py-1 rounded-xl border border-app-border text-[11px]"
                        />
                      </div>
                    </div>

                    {/* More cognitive settings (thinking mode, structured output) */}
                    <div className="grid grid-cols-2 gap-3 pb-2.5 border-b border-app-border/30">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-app-text text-[10px] block">
                            Thinking Mode
                          </span>
                          <span className="text-[8.5px] text-app-text-muted font-medium">
                            For reasoning models
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAiConfig({
                              ...aiConfig,
                              thinking_enabled: !aiConfig.thinking_enabled,
                            })
                          }
                          className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            aiConfig.thinking_enabled
                              ? 'bg-amber-500'
                              : 'bg-app-border'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out ${
                              aiConfig.thinking_enabled
                                ? 'translate-x-4'
                                : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-app-text text-[10px] block">
                            Structured JSON
                          </span>
                          <span className="text-[8.5px] text-app-text-muted font-medium">
                            Force JSON schema
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAiConfig({
                              ...aiConfig,
                              structured_output: !aiConfig.structured_output,
                            })
                          }
                          className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            aiConfig.structured_output
                              ? 'bg-amber-500'
                              : 'bg-app-border'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white transition duration-200 ease-in-out ${
                              aiConfig.structured_output
                                ? 'translate-x-4'
                                : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* System Prompt Instructions */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                        Global System Directives
                      </label>
                      <textarea
                        rows={2}
                        value={aiConfig.system_prompt || ''}
                        onChange={(e) =>
                          setAiConfig({
                            ...aiConfig,
                            system_prompt: e.target.value,
                          })
                        }
                        placeholder="Inject custom system instructions here to shape the assistant's personality..."
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
                        <div className="flex items-center gap-1.5 mb-1 text-[10.5px] uppercase">
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
                      <button
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
                              Pinging...
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
                      </button>

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

                    {/* Right: Status Badge */}
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0 whitespace-nowrap">
                      Authorized
                      <span className="hidden xl:inline"> Access</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-4">
                    <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                      Automatically or manually replicate and append products,
                      inventory adjustments, transactions, customers, suppliers,
                      debts, and employee lists to your Google Sheet.
                    </p>

                    <div className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <span className="font-extrabold text-app-text text-[11px] block">
                          Enable Sheets Replication
                        </span>
                        <span className="text-[9px] text-app-text-muted font-medium block mt-0.5">
                          Toggle live nightly schedule execution
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
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
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
                      <p className="text-[8px] text-app-text-muted leading-tight mt-1">
                        Provide Editor permissions to the Service Account email
                        address in Google Sheets.
                      </p>
                    </div>

                    {/* Google Service Account JSON */}
                    <div className="flex flex-col gap-1 border-t border-app-border/30 pt-3">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider flex justify-between">
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
                            : '•••••••••••••••••••••••••••••••• (Click Show/Edit JSON to paste credentials)'
                        }
                        disabled={!showSaJsonPass}
                        rows={5}
                        className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[10px] font-mono whitespace-pre"
                      />
                    </div>

                    {/* Backup Schedule & Status Info */}
                    <div className="grid  grid-cols-2 md:grid-cols-1 gap-3 border-t border-app-border/30 pt-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
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
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 animate-fade-in shrink-0">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Connected
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-500/10 border border-slate-500/20 text-app-text-muted shrink-0">
                          Offline
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0">
                        Authorized Access
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Enabled global toggle */}
                    <div className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <span className="font-extrabold text-app-text text-[11px] block">
                          Enable Twilio SMS Dispatches
                        </span>
                        <span className="text-[9.5px] text-app-text-muted font-medium block mt-0.5">
                          Automate messaging, dispatch receipts, and emergency
                          alerts to staff and owner
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

                    {/* Provider selection */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                        SMS Provider
                      </label>
                      <SearchableDropdown
                        items={[
                          { id: 'twilio', label: 'Twilio SMS Platform' },
                          {
                            id: 'future_mock',
                            label: 'Local Offline Simulator',
                          },
                        ]}
                        selectedValue={smsConfig.provider || 'twilio'}
                        onChange={(val) =>
                          setSmsConfig({
                            ...smsConfig,
                            provider: val as any,
                          })
                        }
                        placeholder="SMS Provider"
                      />
                    </div>

                    {/* Default Country Prefix Selector */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
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
                        <span className="text-[9.5px] text-app-text-muted font-medium">
                          Used to normalize numbers that lack country prefix
                          automatically.
                        </span>
                      </div>
                    </div>

                    {smsConfig.provider === 'twilio' ? (
                      <>
                        {/* Account SID */}
                        <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                          <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
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
                            <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                              Twilio Auth Token
                            </label>
                            </div>
                          <PasswordInput variant="app" label="" required={false} autoComplete="off" value={smsConfig.auth_token} onChange={(auth_token) => setSmsConfig({ ...smsConfig, auth_token })} placeholder="Enter secret auth token..." />
                        </div>

                        {/* Messaging SID or Sender Phone Number Selection */}
                        <div className="flex flex-col gap-2.5 border-t border-app-border/30 pt-3">
                          <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                            Sender Identifier Configuration
                          </label>
                          <p className="text-[9px] text-app-text-muted font-medium leading-relaxed mb-1">
                            Configure how Twilio maps sender identities.
                            Messaging Service SID is recommended for high
                            volume.
                          </p>

                          <div className="grid grid-cols-1  gap-3.5">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[8.5px] font-extrabold text-app-text uppercase tracking-wider">
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
                              <span className="text-[8.5px] font-extrabold text-app-text uppercase tracking-wider">
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
                    ) : (
                      <div className="p-3 bg-app-bg border border-app-border rounded-2xl text-[10.5px] text-app-text-muted font-medium leading-relaxed border-dashed">
                        Using the{' '}
                        <strong className="text-app-text">
                          Future Extensible Mock Provider
                        </strong>
                        . It mock-sends SMS messages to the system logs. No
                        credentials or Twilio setups are required!
                      </div>
                    )}

                    {/* Emergency Owner Phone Number Input with Auto Normalization */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                        Default Owner Emergency Contact
                      </label>
                      <p className="text-[9px] text-app-text-muted font-medium leading-relaxed mb-1">
                        This number is saved in E.164 format and receives
                        instant system alerts and daily offline summary logs.
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
                        <span className="text-[8.5px] text-emerald-500 font-mono font-bold mt-1 block">
                          Saved normalized E.164 format:{' '}
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
                        <div className="flex items-center gap-1.5 mb-1 text-[10.5px] uppercase">
                          {smsTestResult.success ? (
                            <CheckCircle2 size={13} />
                          ) : (
                            <AlertTriangle size={13} />
                          )}
                          <span>
                            {smsTestResult.success
                              ? 'SMS Dispatched'
                              : 'Dispatch Failed'}
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
                              Pinging...
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

              {/* Supabase & Cloud Database Integrations (Admins & Owners only) */}
              {activeSection === 'database' && hasRolePermission(currentRole, 'settings.integrations') &&
                configManager.getActiveEnvironment() === 'Developer Mode' && (
                  <div
                    id="database-integrations-card"
                    className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm animate-fade-in"
                  >
                    <div className="flex items-center gap-2 border-b border-app-border/40 pb-2.5">
                      <Database size={16} className="text-amber-500" />
                      <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                        Supabase Integration
                      </h3>
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-4 py-1">
                        <div>
                          <span className="font-extrabold text-app-text text-[11px] block">
                            Live Supabase Sync
                          </span>
                          <span className="text-[9px] text-app-text-muted font-medium block mt-0.5">
                            Toggle live background replication and auth syncing
                          </span>
                        </div>
                        <Switch
                          checked={dbSyncEnabled}
                          onChange={() => {
                            const newVal = !dbSyncEnabled;
                            setDbSyncEnabled(newVal);
                            localStorage.setItem(
                              'kkm_db_sync_enabled',
                              String(newVal),
                            );
                            showToast(
                              'Supabase Sync',
                              `Live database sync has been ${
                                newVal ? 'enabled' : 'disabled'
                              }.`,
                            );
                          }}
                          ariaLabel="Live database sync"
                        />
                      </div>

                      {/* Supabase URL */}
                      <div className="flex flex-col gap-1 border-t border-app-border/30 pt-3">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                          Supabase API URL
                        </label>
                        <input
                          type="text"
                          value={supabaseUrl}
                          onChange={(e) => setSupabaseUrl(e.target.value)}
                          placeholder="https://your-project.supabase.co"
                          className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                        />
                      </div>

                      {/* Supabase Anon Key */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider flex justify-between">
                          <span>Supabase Anon Key</span>
                          </label>
                        <PasswordInput variant="app" label="" required={false} autoComplete="off" value={supabaseKey} onChange={setSupabaseKey} placeholder="eyJhbGciOiJIUzI1NiIsIn..." />
                      </div>

                      {/* DB Host */}
                      <div className="flex flex-col gap-1 border-t border-app-border/30 pt-3">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                          Postgres DB Host
                        </label>
                        <input
                          type="text"
                          value={dbHost}
                          onChange={(e) => setDbHost(e.target.value)}
                          placeholder="db.your-project.supabase.co"
                          className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                        />
                      </div>

                      {/* DB Port & Name */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1 flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            DB Port
                          </label>
                          <input
                            type="text"
                            value={dbPort}
                            onChange={(e) => setDbPort(e.target.value)}
                            placeholder="5432"
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                          />
                        </div>
                        <div className="col-span-2 flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            DB Name
                          </label>
                          <input
                            type="text"
                            value={dbName}
                            onChange={(e) => setDbName(e.target.value)}
                            placeholder="postgres"
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                          />
                        </div>
                      </div>

                      {/* DB User */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                          DB Username
                        </label>
                        <input
                          type="text"
                          value={dbUser}
                          onChange={(e) => setDbUser(e.target.value)}
                          placeholder="postgres.your-project"
                          className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                        />
                      </div>

                      {/* DB Password */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider flex justify-between">
                          <span>DB Password</span>
                          </label>
                        <PasswordInput variant="app" label="" required={false} autoComplete="off" value={dbPass} onChange={setDbPass} placeholder="Your Database Password" />
                      </div>
                    </div>
                  </div>
                )}
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
                <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                  Interactive Guided Tour
                </h3>
              </div>
              <div className="flex flex-col gap-3.5">
                <div>
                  <span className="font-extrabold text-app-text text-[11px] block">
                    First-Time Onboarding Walkthrough
                  </span>
                  <span className="text-[9.5px] text-app-text-muted font-medium block mt-0.5">
                    Need a refresher? Restart the step-by-step interactive
                    onboarding tour anytime.
                  </span>
                </div>
                <button
                  onClick={() => {
                    onRestartTour?.();
                    showToast(
                      'Tour Started',
                      'Guided onboarding walkthrough started.',
                    );
                  }}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Play size={12} />
                  <span>Restart Walkthrough Tour</span>
                </button>
              </div>
            </div>
            )}
            {/* 4. OPERATOR SESSION (Available to all) */}
            {activeSection === 'session' && (
            <div className="bg-red-500/5 border border-red-500/10 rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-red-500/10 pb-2.5">
                <LogOut size={16} className="text-red-500" />
                <h3 className="text-xs font-extrabold text-red-500 uppercase tracking-wider font-display">
                  Operator Session
                </h3>
              </div>
              <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                Sign out of your active online account session securely.
              </p>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    showToast(
                      'Logged Out',
                      'Operator session closed successfully.',
                    );
                  }}
                  className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white font-black rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider text-[10px]"
                >
                  <LogOut size={13} />
                  <span>Log Out of Account</span>
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
                    <h3 className="text-sm font-black text-app-text uppercase tracking-wider font-display">
                      {meta.label} Request
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
                    <p className="text-[9px] text-app-text-muted leading-relaxed font-medium">
                      Privacy Guard: We only request hardware access when
                      required for checkout transactions or rider routing. You
                      can revoke this permission anytime in settings.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setExplainingPermission(null)}
                      className="py-2.5 bg-app-bg border border-app-border hover:bg-app-border text-app-text font-black rounded-xl transition cursor-pointer text-[10px] uppercase tracking-wider"
                    >
                      Maybe Later
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
                      className="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition cursor-pointer text-[10px] uppercase tracking-wider shadow-md"
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
                <h3 className="text-sm font-black text-app-text uppercase tracking-wider font-display">
                  Unblock Permission Guide
                </h3>
                <p className="text-[10px] text-app-text-muted leading-relaxed mt-2 font-medium px-4">
                  Your web browser has blocked this site from requesting
                  permission. Follow these simple steps to enable access:
                </p>
              </div>

              <div className="flex flex-col gap-2.5 text-left bg-app-bg/60 p-4 border border-app-border rounded-2xl text-[10px] font-medium text-app-text-muted">
                <div className="flex gap-2">
                  <span className="font-extrabold text-amber-500">1.</span>
                  <span>
                    Click the <strong>Lock (🔒)</strong> or{' '}
                    <strong>Tune</strong> settings icon in your browser's
                    address bar (top left of the screen, next to the web URL).
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="font-extrabold text-amber-500">2.</span>
                  <span>
                    Locate the blocked permission and change its dropdown status
                    toggle to <strong>Allow</strong>.
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="font-extrabold text-amber-500">3.</span>
                  <span>
                    Reload this page to synchronize your browser's updated
                    device permissions.
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
                  className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-500 font-black rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer"
                >
                  Open Device System Settings
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowWebSettingsGuide(false);
                  checkAllDevicePermissions();
                }}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition cursor-pointer text-[10px] uppercase tracking-wider shadow-md"
              >
                I've Updated Site Permissions
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Success Banner */}
      {saveSuccess && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-4 py-2.5 rounded-full flex items-center gap-1.5 shadow-lg z-50 text-[10px] font-black uppercase tracking-wider animate-bounce">
          <CheckCircle2 size={13} />
          <span>Application configurations successfully synced!</span>
        </div>
      )}
    </div>
  );
}
