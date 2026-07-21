import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useBusinessStore } from '../stores/businessStore';
import { hasRolePermission } from '../utils/permissions';
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
  Printer,
  QrCode,
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
} from 'lucide-react';
import { BackupConfig, BackupHistoryLog } from '../types';
import { useDevicePermission } from '../hooks/useDevicePermission';
import { PermissionType } from '../services/devicePermissionService';
import { configManager } from '../services/configManager';
import {
  ReceiptService,
  ReceiptTemplateManager,
} from '../services/receipt/ReceiptService';
import {
  BusinessReceiptSettings,
  ReceiptTemplateType,
  PaperWidth,
  QRCodeContentOption,
} from '../services/receipt/types';
import { motion, AnimatePresence } from 'motion/react';
import SearchableDropdown from '../components/SearchableDropdown';
import {
  normalizePhone,
  validatePhone,
  SUPPORTED_COUNTRIES,
} from '../utils/phoneUtils';
import { printerService } from '../services/printer/PrinterService';
import {
  BluetoothPrinterDevice,
  PrinterConnectionState,
  PrinterConfig,
} from '../services/printer/types';
import {
  NotificationPref,
  getNotificationPrefs,
  saveNotificationPrefs,
  ROLE_ELIGIBLE_CATEGORIES,
} from '../stores/notificationStore';
import { SupabaseService } from '../services/supabaseService';

const NOTIF_CAT_DETAILS: Record<string, { label: string; desc: string }> = {
  inventory: {
    label: 'Inventory & Stock Alerts',
    desc: 'Low stock, out of stock notices and audit logs',
  },
  logistics: {
    label: 'Logistics & Rider Dispatches',
    desc: 'Rider dispatch confirmations, route issues and delivery alerts',
  },
  security: {
    label: 'System Security & PIN Audits',
    desc: 'PIN updates, biometric actions, and unauthorized clearances',
  },
  sales: {
    label: 'POS Sales Checkouts',
    desc: 'Register checkout confirmations and transaction receipts',
  },
  audit: {
    label: 'Financial Reconciliation',
    desc: 'Shift closes, daily sales ledgers, and cash reconciliation',
  },
};

interface SettingsViewProps {
  onRestartTour?: () => void;
}

export default function SettingsView({ onRestartTour }: SettingsViewProps = {}) {
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
  const [explainingPermission, setExplainingPermission] = useState<string | null>(null);
  const [showWebSettingsGuide, setShowWebSettingsGuide] = useState(false);

  // Receipt Customization Engine States
  const [receiptSettings, setReceiptSettings] = useState<BusinessReceiptSettings>(() => {
    return ReceiptService.getSettings(activeBusinessId || 'biz-1');
  });
  const [receiptSubTab, setReceiptSubTab] = useState<'design' | 'branding' | 'messages' | 'codes' | 'printers'>('design');

  useEffect(() => {
    if (activeBusinessId) {
      setReceiptSettings(ReceiptService.getSettings(activeBusinessId));
    }
  }, [activeBusinessId]);

  // Hardware Thermal Printer states
  const [printerConfig, setPrinterConfig] = useState<PrinterConfig>(() =>
    printerService.getConfig(),
  );
  const [discoveredPrinters, setDiscoveredPrinters] = useState<BluetoothPrinterDevice[]>([]);
  const [printerConnState, setPrinterConnState] = useState<PrinterConnectionState>('Disconnected');

  useEffect(() => {
    const unsubState = printerService.onStateChange((state) => {
      setPrinterConnState(state);
    });

    const unsubDevices = printerService.onDevicesDiscovered((devices) => {
      setDiscoveredPrinters(devices);
    });

    return () => {
      unsubState();
      unsubDevices();
    };
  }, []);

  const handleSavePrinterConfig = (updates: Partial<PrinterConfig>) => {
    printerService.saveConfig(updates);
    setPrinterConfig(printerService.getConfig());
  };

  const handleSaveReceiptConfig = () => {
    if (activeBusinessId) {
      ReceiptService.saveSettings(activeBusinessId, receiptSettings);
      showToast('Success', 'Receipt configuration saved successfully.', undefined, 'success');
    }
  };

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
  const [showAiKey, setShowAiKey] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
  const [showSmsToken, setShowSmsToken] = useState(false);
  const [testingSms, setTestingSms] = useState(false);
  const [savingSms, setSavingSms] = useState(false);
  const [smsTestResult, setSmsTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Raw inputs for E.164 normalization tracking
  const [rawOwnerPhone, setRawOwnerPhone] = useState('');
  const [rawFromPhone, setRawFromPhone] = useState('');
  const [selectedCountryForOwner, setSelectedCountryForOwner] = useState('+254');
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
      if (err?.code === 'SESSION_EXPIRED' || err?.message?.includes('expired')) {
        showToast('Session Expired', 'Please log out and log back in to continue.', undefined, 'error');
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
      if (err?.code === 'SESSION_EXPIRED' || err?.message?.includes('expired')) {
        showToast('Session Expired', 'Please log out and log back in to continue.', undefined, 'error');
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
      throw new Error('Access Denied: Only Owners can view or modify API credentials.');
    }

    // --- NEW: SAFE FRONTEND VALIDATION ---
    // If the service account is coming from a textarea and isn't masked out yet
    if (sheetsConfig.googleServiceAccount && !sheetsConfig.googleServiceAccount.includes('••••')) {
      try {
        // Test if it's valid JSON
        const parsed = JSON.parse(sheetsConfig.googleServiceAccount);
        
        // Double check required Google parameters
        if (!parsed.client_email || !parsed.private_key) {
          throw new Error('Missing "client_email" or "private_key" inside the JSON.');
        }
      } catch (jsonErr: any) {
        throw new Error(`Invalid Google Service Account JSON: ${jsonErr.message}`);
      }
    }
    // -------------------------------------

    const data = await SupabaseService.callEdgeFunction('backup-config', {
      action: 'save',
      businessId: activeBusinessId,
      activeRole: currentRole,
      config: sheetsConfig, // Sent cleanly as an object containing strings
    });

    if (!data?.success) throw new Error(data?.error || 'Failed to update remote variables.');

    showToast(
      'Backup Settings Saved',
      'Google Sheets configuration stored securely.',
      undefined,
      'success',
    );
    fetchBackupData();
  } catch (err: any) {
    showToast('Save Failed', err.message || 'Network Error', undefined, 'error');
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
          data.message || 'All data tables written to Google Sheets successfully!',
          undefined,
          'success',
        );
        fetchBackupData();
      } else {
        showToast('Backup Failed', data?.error || 'Failed to run backup.', undefined, 'error');
        fetchBackupData();
      }
    } catch (err: any) {
      // Handle session expiry gracefully
      if (err?.code === 'SESSION_EXPIRED' || err?.message?.includes('session')) {
        showToast(
          'Session Expired',
          'Your login session has expired. Please log out and log back in, then try again.',
          undefined,
          'error',
        );
      } else {
        showToast('Backup Failed', err.message || 'Network Error', undefined, 'error');
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
        showToast('Import Failed', data?.error || 'Failed to run import.', undefined, 'error');
        fetchBackupData();
      }
    } catch (err: any) {
      showToast('Import Failed', err.message || 'Network Error', undefined, 'error');
    } finally {
      setRunningImport(false);
    }
  };

  const handleRetryBackup = async (logId: string) => {
    setRetryingLogId(logId);
    showToast('Retry Triggered', 'Attempting to re-execute failed backup...', undefined, 'info');
    try {
      const data = await SupabaseService.callEdgeFunction('backup-config', {
        action: 'retry',
        businessId: activeBusinessId,
        activeRole: currentRole,
        logId,
      });

      if (data?.success) {
        showToast('Retry Success', 'Backup succeeded on retry!', undefined, 'success');
        fetchBackupData();
      } else {
        showToast('Retry Failed', data?.error || 'Retry attempt failed.', undefined, 'error');
        fetchBackupData();
      }
    } catch (err: any) {
      showToast('Retry Failed', err.message || 'Network Error', undefined, 'error');
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
        console.error('Failed to load SMS configuration from edge engine:', err);
      }
    };

    fetchSmsConfig();
  }, [activeBusinessId, currentRole]);

  const handleSaveSmsConfig = async () => {
    setSavingSms(true);
    setSmsTestResult(null);
    try {
      if (currentRole !== 'Owner') {
        throw new Error('Access Denied: Only Owners can view or modify API credentials.');
      }
      const data = await SupabaseService.callEdgeFunction('sms-config', {
        action: 'save',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: smsConfig,
      });

      if (!data?.success) throw new Error(data?.error || 'Failed to sync parameters.');

      showToast(
        'SMS Settings Saved',
        'Twilio configuration stored securely in database.',
        undefined,
        'success',
      );
    } catch (err: any) {
      showToast('SMS Save Failed', err.message || 'Network Error', undefined, 'error');
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
        showToast('Test SMS Sent', 'Verification message dispatched successfully!', undefined, 'success');
      } else {
        setSmsTestResult({ success: false, message: data?.error || 'Delivery failed.' });
        showToast('Test SMS Failed', data?.error || 'Twilio SMS test failed.', undefined, 'error');
      }
    } catch (err: any) {
      setSmsTestResult({ success: false, message: err.message || 'Network Error' });
      showToast('Test SMS Failed', err.message || 'Network Error', undefined, 'error');
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
        throw new Error('Access Denied: Only Owners can view or modify API credentials.');
      }
      const data = await SupabaseService.callEdgeFunction('ai-config', {
        action: 'save',
        businessId: activeBusinessId,
        activeRole: currentRole,
        config: aiConfig,
      });

      console.log('Response data',  data);
      
      if (data?.success) {
        setAiConfig(data.config);
        showToast('AI Config Saved', 'AI configuration saved securely.', undefined, 'success');
      } else {
        throw new Error(data?.error || 'Failed to update remote variables.');
      }
    } catch (err: any) {
      showToast('Save Failed', err.message || 'Failed to save AI config', undefined, 'error');
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
        showToast('Connection Success', 'AI Connection verified successfully!', undefined, 'success');
      } else {
        setAiTestResult({ success: false, message: data?.error || 'Connection failed.' });
        showToast('Connection Failed', data?.error || 'AI Connection test failed.', undefined, 'error');
      }
    } catch (err: any) {
      setAiTestResult({ success: false, message: err.message || 'Network Error' });
      showToast('Connection Failed', err.message || 'Network Error', undefined, 'error');
    } finally {
      setTestingAi(false);
    }
  };

  // System States
  const [allowPush, setAllowPush] = useState(() => localStorage.getItem('kkm_pref_push') !== 'false');
  const [allowSMS, setAllowSMS] = useState(() => localStorage.getItem('kkm_pref_sms') !== 'false');
  const [passcodeType, setPasscodeType] = useState(() => localStorage.getItem('kkm_passcode_type') || '4');
  const [ringtone, setRingtone] = useState(() => localStorage.getItem('kkm_pref_ringtone') || 'Milk Bell');
  const [offlineLimit, setOfflineLimit] = useState(() => localStorage.getItem('kkm_pref_offline_limit') || '12');
  const [allowWorkerSettings, setAllowWorkerSettings] = useState(() => localStorage.getItem('kkm_allow_worker_personal_settings') !== 'false');
  const [deviceAccountId, setDeviceAccountId] = useState(() => localStorage.getItem('kkm_device_account_id') || 'emp-1');

  // Database & Supabase settings states
  const [supabaseUrl, setSupabaseUrl] = useState(() => localStorage.getItem('kkm_supabase_url') || 'https://bvyzujgqyvaxqfzhwqnd.supabase.co');
  const [supabaseKey, setSupabaseKey] = useState(() => localStorage.getItem('kkm_supabase_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
  const [dbHost, setDbHost] = useState(() => localStorage.getItem('kkm_db_host') || 'aws-0-eu-central-1.pooler.supabase.com');
  const [dbPort, setDbPort] = useState(() => localStorage.getItem('kkm_db_port') || '5432');
  const [dbName, setDbName] = useState(() => localStorage.getItem('kkm_db_name') || 'postgres');
  const [dbUser, setDbUser] = useState(() => localStorage.getItem('kkm_db_user') || 'postgres.bvyzujgqyvaxqfzhwqnd');
  const [dbPass, setDbPass] = useState(() => localStorage.getItem('kkm_db_pass') || 'kkm_milk_secure_2026');
  const [dbSyncEnabled, setDbSyncEnabled] = useState(() => localStorage.getItem('kkm_db_sync_enabled') !== 'false');
  const [showDbPass, setShowDbPass] = useState(false);
  const [showKeyPass, setShowKeyPass] = useState(false);

  // Load current employee notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotificationPref>(() => {
    const empId = currentEmployee ? currentEmployee.id : 'emp-1';
    const empRole = currentEmployee ? currentEmployee.role : 'Owner';
    return getNotificationPrefs(empId, empRole);
  });

  useEffect(() => {
    const empId = currentEmployee ? currentEmployee.id : 'emp-1';
    const empRole = currentEmployee ? currentEmployee.role : 'Owner';
    setNotifPrefs(getNotificationPrefs(empId, empRole));
  }, [currentEmployee]);

  const playChimeTone = (tone: string) => { /* Audio implementation */ };
  const handleTestRingtone = (tone: string) => { /* Audio testing implementation */ };

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
              <span>Admin & Preferences Panel</span>
            </h2>
            <span className="text-[10px] text-app-text-muted font-medium">
              Configure global environment & account smart security
            </span>
          </div>
        </div>
      </div>

      {/* Main Settings Panel */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 pb-6 font-semibold text-xs">
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
          <>
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 w-full items-start">
              {/* 0. INTERACTIVE GUIDE TOUR SECTION */}
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
                      Need a refresher? Restart the step-by-step interactive onboarding tour anytime.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      onRestartTour?.();
                      showToast('Tour Started', 'Guided onboarding walkthrough started.');
                    }}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Play size={12} />
                    <span>Restart Walkthrough Tour</span>
                  </button>
                </div>
              </div>

              {/* Enterprise AI Platform configuration card */}
              {hasRolePermission(currentRole, 'settings.integrations') && (
                <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Brain
                        size={16}
                        className="text-amber-500 "
                      />
                      <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                        Workspace Assistant Platform
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 text-amber-500">
                      Authorized Access
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
                      <button
                        type="button"
                        onClick={() =>
                          setAiConfig({
                            ...aiConfig,
                            enabled: !aiConfig.enabled,
                          })
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          aiConfig.enabled ? 'bg-amber-500' : 'bg-app-border'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-900 shadow-lg ring-0 transition duration-200 ease-in-out ${
                            aiConfig.enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
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
      { id: 'huggingface', label: 'Hugging Face (Server Rotation Tokens - Recommended)' },
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
      
      if (prov === 'huggingface') defaultModel = 'Qwen/Qwen2.5-Coder-32B-Instruct';
      else if (prov === 'gemini') defaultModel = 'gemini-2.5-flash';
      else if (prov === 'openai') defaultModel = 'gpt-4o-mini';
      else if (prov === 'anthropic') defaultModel = 'claude-3-5-haiku-latest';
      else if (prov === 'deepseek') defaultModel = 'deepseek-chat';
      else if (prov === 'groq') defaultModel = 'llama-3.3-70b-versatile';
      else if (prov === 'openrouter') defaultModel = 'meta-llama/llama-3.3-70b-instruct';

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

                    {/* Hugging Face Managed Server-Side Token Rotation Badge */}
                    {(!aiConfig.provider || aiConfig.provider === 'huggingface') && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider block">Server Token Pool Active</span>
                          </div>
                          <p className="text-[9.5px] text-app-text-muted font-medium leading-tight">
                            Requests are automatically load-balanced across managed secrets (<code className="text-emerald-400 font-mono">HF_TOKEN_A..J</code>) with automatic rate-limit rotation & instant failover.
                          </p>
                        </div>
                        <span className="text-[8.5px] font-black bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded-lg border border-emerald-500/30 shrink-0 uppercase tracking-wider">
                          No Key Required
                        </span>
                      </div>
                    )}

                    {/* API Key Input (Optional for Hugging Face, required for other providers) */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                          API Access Token / Key {aiConfig.provider === 'huggingface' ? '(Optional Override)' : '*'}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowAiKey(!showAiKey)}
                          className="text-[9.5px] font-bold text-amber-500 hover:underline"
                        >
                          {showAiKey ? 'Hide Key' : 'Show Key'}
                        </button>
                      </div>
                      <input
                        type={showAiKey ? 'text' : 'password'}
                        value={aiConfig.api_key}
                        onChange={(e) =>
                          setAiConfig({ ...aiConfig, api_key: e.target.value })
                        }
                        placeholder={aiConfig.provider === 'huggingface' ? 'Optional custom HF token (Server tokens used by default)...' : 'Enter provider secret key...'}
                        className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                      />
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
                        {(!aiConfig.provider || aiConfig.provider === 'huggingface') && (
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
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <button
                        type="button"
                        disabled={testingAi || savingAi}
                        onClick={handleTestAiConnection}
                        className="py-2 px-3 bg-app-bg hover:bg-app-border border border-app-border hover:border-amber-500/25 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black"
                      >
                        {testingAi ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-amber-500"
                            />
                            <span>Pinging Provider...</span>
                          </>
                        ) : (
                          <>
                            <Cpu size={11} className="text-amber-500" />
                            <span>Test Connection</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveAiConfig}
                        disabled={savingAi}
                        className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black shadow-sm"
                      >
                        {savingAi ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-slate-950"
                            />
                            <span>Saving Settings...</span>
                          </>
                        ) : (
                          <>
                            <Save size={11} />
                            <span>Save Assistant Settings</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Twilio SMS Platform configuration card */}
              {hasRolePermission(currentRole, 'settings.integrations') && (
                <div id="sms-gateway-config-card" className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Smartphone
                        size={16}
                        className="text-amber-500 "
                      />
                      <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                        SMS Gateway Configuration
                      </h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {smsConfig.enabled ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 animate-fade-in">
                          <span className="h-1 w-1 rounded-full bg-emerald-500 " />{' '}
                          Connected
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-slate-500/10 border border-slate-500/20 text-app-text-muted">
                          Offline
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 text-amber-500">
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
                      <button
                        type="button"
                        onClick={() =>
                          setSmsConfig({
                            ...smsConfig,
                            enabled: !smsConfig.enabled,
                          })
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          smsConfig.enabled ? 'bg-amber-500' : 'bg-app-border'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-900 shadow-lg ring-0 transition duration-200 ease-in-out ${
                            smsConfig.enabled
                              ? 'translate-x-5'
                              : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Provider selection */}
                    <div className="flex flex-col gap-1.5 border-t border-app-border/30 pt-3">
                      <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                        SMS Provider
                      </label>
                      <SearchableDropdown
                        items={[
                          { id: 'twilio', label: 'Twilio SMS Platform' },
                          { id: 'future_mock', label: 'Local Offline Simulator' }
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
                          items={SUPPORTED_COUNTRIES.map((c) => ({ id: c.code, label: `${c.flag} ${c.code} (${c.name})` }))}
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
                            <button
                              type="button"
                              onClick={() => setShowSmsToken(!showSmsToken)}
                              className="text-[9.5px] font-bold text-amber-500 hover:underline"
                            >
                              {showSmsToken ? 'Hide Secret' : 'Show Secret'}
                            </button>
                          </div>
                          <input
                            type={showSmsToken ? 'text' : 'password'}
                            value={smsConfig.auth_token}
                            onChange={(e) =>
                              setSmsConfig({
                                ...smsConfig,
                                auth_token: e.target.value,
                              })
                            }
                            placeholder="Enter secret auth token..."
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                          />
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
                              <div className="grid  grid-cols-4 gap-1.5">
                                <SearchableDropdown
                                  items={SUPPORTED_COUNTRIES.map((c) => ({ id: c.code, label: `${c.flag} ${c.code}` }))}
                                  selectedValue={selectedCountryForFrom}
                                  onChange={(val) =>
                                    setSelectedCountryForFrom(val)
                                  }
                                  placeholder="Code"
                                  className="w-28 shrink-0 col-span-1"
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
                      <div className="grid grid-cols-4 gap-1.5">
                        <SearchableDropdown
                          items={SUPPORTED_COUNTRIES.map((c) => ({ id: c.code, label: `${c.flag} ${c.code}` }))}
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
                          className="w-28 shrink-0 col-span-1"
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
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <button
                        type="button"
                        disabled={testingSms || savingSms}
                        onClick={handleTestSmsConnection}
                        className="py-2 px-3 bg-app-bg hover:bg-app-border border border-app-border hover:border-amber-500/25 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black"
                      >
                        {testingSms ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-amber-500"
                            />
                            <span>Pinging Twilio...</span>
                          </>
                        ) : (
                          <>
                            <Smartphone size={11} className="text-amber-500" />
                            <span>Send Test SMS</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={testingSms || savingSms}
                        onClick={handleSaveSmsConfig}
                        className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black shadow-sm"
                      >
                        {savingSms ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-slate-950"
                            />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Save size={11} />
                            <span>Save SMS settings</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Google Sheets Backup Integration Card */}
              {hasRolePermission(currentRole, 'settings.storage') && (
                <div className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet size={16} className="text-amber-500" />
                      <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                        Google Sheets Backup
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 text-amber-500">
                      Authorized Access
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
                      <button
                        type="button"
                        onClick={() =>
                          setSheetsConfig((prev) => ({
                            ...prev,
                            enabled: !prev.enabled,
                          }))
                        }
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          sheetsConfig.enabled
                            ? 'bg-amber-500'
                            : 'bg-app-border'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-900 shadow-lg ring-0 transition duration-200 ease-in-out ${
                            sheetsConfig.enabled
                              ? 'translate-x-5'
                              : 'translate-x-0'
                          }`}
                        />
                      </button>
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-app-border/30 pt-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[9.5px] font-black text-app-text-muted uppercase tracking-wider block">
                          Backup Schedule
                        </label>
                        <SearchableDropdown
                          items={[
                            { id: 'nightly_12am', label: 'Every night at 12:00 AM' },
                            { id: 'nightly_3am', label: 'Every night at 3:00 AM' },
                            { id: 'every_12h', label: 'Every 12 hours' }
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

                      <div className="flex flex-col gap-1 bg-app-bg/50 border border-app-border/60 rounded-2xl p-2.5">
                        <span className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">
                          Sync Integrity Status
                        </span>
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
                    <div className="flex justify-end gap-2.5 pt-2 border-t border-app-border/30">
                      <button
                        type="button"
                        disabled={
                          runningImport ||
                          savingBackupConfig ||
                          !sheetsConfig.googleSheetUrl
                        }
                        onClick={handleRunImport}
                        className="py-2 px-3 bg-app-bg border border-app-border hover:border-amber-500 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black"
                      >
                        {runningImport ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-amber-500"
                            />
                            <span>Importing...</span>
                          </>
                        ) : (
                          <>
                            <Download size={11} className="text-amber-500" />
                            <span>Import Now</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={
                          runningBackup ||
                          savingBackupConfig ||
                          !sheetsConfig.googleSheetUrl
                        }
                        onClick={handleRunBackup}
                        className="py-2 px-3 bg-app-bg border border-app-border hover:border-amber-500 text-app-text rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black"
                      >
                        {runningBackup ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-amber-500"
                            />
                            <span>Executing Backup...</span>
                          </>
                        ) : (
                          <>
                            <Cloud size={11} className="text-amber-500" />
                            <span>Backup Now (Manual)</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={savingBackupConfig || runningBackup}
                        onClick={handleSaveBackupConfig}
                        className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider text-[9px] font-black shadow-sm"
                      >
                        {savingBackupConfig ? (
                          <>
                            <RefreshCw
                              size={11}
                              className="animate-spin text-slate-950"
                            />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Save size={11} />
                            <span>Save Settings</span>
                          </>
                        )}
                      </button>
                    </div>

                    
                  </div>
                </div>
              )}

              {/* RECEIPT SYSTEM OVERHAUL: PRODUCTION-READY RECEIPT ENGINE SETTINGS PANEL */}
              {hasRolePermission(currentRole, 'settings.tax') && (
                <div
                  className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm"
                  id="receipt-engine-customization-settings"
                >
                  <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                    <div className="flex items-center gap-2">
                      <ReceiptText size={16} className="text-amber-500" />
                      <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                        Receipt Customization Engine
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 text-amber-500">
                        Templates & Codes
                      </span>
                      <button
                        onClick={handleSaveReceiptConfig}
                        className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        <Save size={12} />
                        Save
                      </button>
                    </div>
                  </div>

                  <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                    Design beautiful transaction vouchers, configure tax/VAT
                    regulations, manage offline metadata, and customize
                    barcodes/QR outputs for high-performance terminal printing.
                  </p>

                  {/* Sub-tab buttons */}
                  <div className="flex flex-wrap md:grid md:grid-cols-5 gap-1 bg-app-bg p-1 rounded-xl border border-app-border/40 text-[9.5px]">
                    <button
                      type="button"
                      onClick={() => setReceiptSubTab('design')}
                      className={`flex-1 min-w-[65px] md:min-w-0 py-1.5 rounded-lg text-center font-bold transition cursor-pointer ${
                        receiptSubTab === 'design'
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'text-app-text-muted hover:text-app-text'
                      }`}
                    >
                      Design
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiptSubTab('branding')}
                      className={`flex-1 min-w-[65px] md:min-w-0 py-1.5 rounded-lg text-center font-bold transition cursor-pointer ${
                        receiptSubTab === 'branding'
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'text-app-text-muted hover:text-app-text'
                      }`}
                    >
                      Branding
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiptSubTab('messages')}
                      className={`flex-1 min-w-[65px] md:min-w-0 py-1.5 rounded-lg text-center font-bold transition cursor-pointer ${
                        receiptSubTab === 'messages'
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'text-app-text-muted hover:text-app-text'
                      }`}
                    >
                      Messages
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiptSubTab('codes')}
                      className={`flex-1 min-w-[65px] md:min-w-0 py-1.5 rounded-lg text-center font-bold transition cursor-pointer ${
                        receiptSubTab === 'codes'
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'text-app-text-muted hover:text-app-text'
                      }`}
                    >
                      Codes
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceiptSubTab('printers')}
                      className={`flex-1 min-w-[65px] md:min-w-0 py-1.5 rounded-lg text-center font-bold transition cursor-pointer ${
                        receiptSubTab === 'printers'
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'text-app-text-muted hover:text-app-text'
                      }`}
                    >
                      Printers
                    </button>
                  </div>

                  <div className="mt-1 space-y-3.5">
                    {/* TAB 1: DESIGN & FORMATS */}
                    {receiptSubTab === 'design' && (
                      <div className="space-y-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            Default Receipt Template
                          </label>
                          <SearchableDropdown
                            items={[
                              {
                                id: 'classic',
                                label: 'Classic Monospaced POS',
                              },
                              {
                                id: 'modern',
                                label: 'Modern Sans-Serif Minimalist',
                              },
                              {
                                id: 'compact',
                                label: 'Super Compact Space Saver',
                              },
                              {
                                id: 'retail',
                                label: 'Retail High-Density Ledger',
                              },
                              {
                                id: 'milk_shop',
                                label: "KayKay's Farm Milk Shop Theme",
                              },
                            ]}
                            selectedValue={receiptSettings.templateType}
                            onChange={(val) =>
                              setReceiptSettings({
                                ...receiptSettings,
                                templateType: val as any,
                              })
                            }
                            placeholder="Select template theme..."
                            searchPlaceholder="Search template themes..."
                          />
                          <span className="text-[8.5px] text-app-text-muted italic block mt-0.5 leading-normal">
                            {receiptSettings.templateType === 'classic' &&
                              'Classic monospaced grid layout with dashed dividers and standard thermal formatting.'}
                            {receiptSettings.templateType === 'modern' &&
                              'Modern sans-serif typography, elegant borders, spacious layout, rounded card format.'}
                            {receiptSettings.templateType === 'compact' &&
                              'Highly condensed layout, tight margins, tiny font sizes, designed to conserve thermal paper.'}
                            {receiptSettings.templateType === 'retail' &&
                              'Full columns for tax tracking, item descriptions, cashier terminal numbers, return policies.'}
                            {receiptSettings.templateType === 'milk_shop' &&
                              'Charming dairy-specific brand theme with custom farm borders and fresh emerald colors.'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Paper Roll Width
                            </label>
                            <SearchableDropdown
                              items={[
                                { id: '58mm', label: '58mm Thermal Receipt' },
                                { id: '80mm', label: '80mm Thermal Receipt' },
                                { id: 'A4', label: 'A4 Full Sheet Standard' },
                              ]}
                              selectedValue={receiptSettings.paperWidth}
                              onChange={(val) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  paperWidth: val as any,
                                })
                              }
                              placeholder="Select paper width..."
                              searchPlaceholder="Search sizes..."
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Currency Denomination
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.currencyFormat}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  currencyFormat: e.target.value as any,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono font-bold"
                              placeholder="KSh"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Date Format
                            </label>
                            <SearchableDropdown
                              items={[
                                { id: 'DD/MM/YYYY', label: 'DD/MM/YYYY (24/12/2026)' },
                                { id: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/24/2026)' },
                                { id: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-12-24)' },
                                { id: 'medium', label: 'Medium Text (Dec 24, 2026)' }
                              ]}
                              selectedValue={receiptSettings.dateFormat}
                              onChange={(val) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  dateFormat: val as any,
                                })
                              }
                              placeholder="Select date format..."
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Time Format
                            </label>
                            <SearchableDropdown
                              items={[
                                { id: '24h', label: '24 Hour (16:35)' },
                                { id: '12h', label: '12 Hour (04:35 PM)' }
                              ]}
                              selectedValue={receiptSettings.timeFormat}
                              onChange={(val) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  timeFormat: val as '12h' | '24h',
                                })
                              }
                              placeholder="Select time format..."
                            />
                          </div>
                        </div>

                        <div className="border-t border-app-border/30 pt-3 flex items-center justify-between gap-4 py-1">
                          <div>
                            <span className="font-extrabold text-app-text text-[11px] block">
                              Show Smart Insights on Receipt
                            </span>
                            <span className="text-[9px] text-app-text-muted font-medium block mt-0.5 leading-tight">
                              Display a personalized product
                              recommendation at the bottom of customer receipts.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setReceiptSettings({
                                ...receiptSettings,
                                showAiRecommendation:
                                  !receiptSettings.showAiRecommendation,
                              })
                            }
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              receiptSettings.showAiRecommendation
                                ? 'bg-amber-500'
                                : 'bg-app-border'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-900 shadow-lg ring-0 transition duration-200 ease-in-out ${
                                receiptSettings.showAiRecommendation
                                  ? 'translate-x-4'
                                  : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* TAB 2: BRANDING & INFO */}
                    {receiptSubTab === 'branding' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Business Header Name
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.businessName}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  businessName: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                              placeholder="KayKay's Milk Shop"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Phone Contact
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.phone}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  phone: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                              placeholder="+254 700 000000"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            Business Address
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.address}
                            onChange={(e) =>
                              setReceiptSettings({
                                ...receiptSettings,
                                address: e.target.value,
                              })
                            }
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                            placeholder="Tom Mboya Street, Nairobi, Kenya"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Email Address
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.email}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  email: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                              placeholder="sales@kaykaysmilk.com"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Website URL
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.website}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  website: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                              placeholder="www.kaykaysmilk.com"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Tax PIN Number (e.g. KRA PIN)
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.pinNumber || ''}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  pinNumber: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono uppercase"
                              placeholder="P051XXXXXXZ"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Company Reg No.
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.registrationNumber || ''}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  registrationNumber: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                              placeholder="CPR/2026/0129"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* TAB 3: MESSAGES & POLICY */}
                    {receiptSubTab === 'messages' && (
                      <div className="space-y-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            Header Tagline / Message
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.headerMessage || ''}
                            onChange={(e) =>
                              setReceiptSettings({
                                ...receiptSettings,
                                headerMessage: e.target.value,
                              })
                            }
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                            placeholder="Your Friendly Neighborhood Dairy Partner"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            Thank You Message
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.thankYouMessage || ''}
                            onChange={(e) =>
                              setReceiptSettings({
                                ...receiptSettings,
                                thankYouMessage: e.target.value,
                              })
                            }
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                            placeholder="Thank you for supporting fresh dairy!"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            Footer Closing Message
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.footerMessage || ''}
                            onChange={(e) =>
                              setReceiptSettings({
                                ...receiptSettings,
                                footerMessage: e.target.value,
                              })
                            }
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                            placeholder="Have a dairy-good day and see you again!"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                            Exchange & Return Policy
                          </label>
                          <textarea
                            rows={2}
                            value={receiptSettings.returnPolicy || ''}
                            onChange={(e) =>
                              setReceiptSettings({
                                ...receiptSettings,
                                returnPolicy: e.target.value,
                              })
                            }
                            className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] leading-normal"
                            placeholder="Perishables cannot be returned. Sealed bottles exchangeable within 24 hours of delivery."
                          />
                        </div>
                      </div>
                    )}

                    {/* TAB 4: CODES & TAX TOGGLES */}
                    {receiptSubTab === 'codes' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Receipt Number Prefix
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.receiptPrefix}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  receiptPrefix: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono uppercase"
                              placeholder="KKM"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Number Sequence format
                            </label>
                            <SearchableDropdown
                              items={[
                                { id: 'PREFIX-YYYY-INCREMENT', label: 'KKM-2026-0418' },
                                { id: 'PREFIX-INCREMENT', label: 'KKM-0418' },
                                { id: 'INCREMENT', label: '0418 (Sequential only)' }
                              ]}
                              selectedValue={receiptSettings.receiptNumberFormat}
                              onChange={(val) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  receiptNumberFormat: val as any,
                                })
                              }
                              placeholder="Select sequence format..."
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 border-t border-app-border/30 pt-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              QR Code Option
                            </label>
                            <SearchableDropdown
                              items={[
                                { id: 'verification_url', label: 'Receipt Verification Link' },
                                { id: 'business_website', label: 'Business Website' },
                                { id: 'payment_link', label: 'M-Pesa payment prompt' },
                                { id: 'feedback_form', label: 'Customer Feedback Form' },
                                { id: 'google_review', label: 'Google Review Redirect' },
                                { id: 'whatsapp_chat', label: 'WhatsApp Direct chat' },
                                { id: 'custom_url', label: 'Custom Redirect URL' }
                              ]}
                              selectedValue={receiptSettings.qrCodeOption}
                              onChange={(val) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  qrCodeOption: val as any,
                                })
                              }
                              placeholder="Select QR option..."
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider">
                              Custom QR URL
                            </label>
                            <input
                              type="text"
                              value={receiptSettings.customQrUrl || ''}
                              onChange={(e) =>
                                setReceiptSettings({
                                  ...receiptSettings,
                                  customQrUrl: e.target.value,
                                })
                              }
                              className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                              placeholder="https://linktr.ee/kaykaysmilk"
                              disabled={
                                receiptSettings.qrCodeOption !== 'custom_url'
                              }
                            />
                          </div>
                        </div>

                      </div>
                    )}

                    {/* TAB 5: THERMAL HARDWARE PRINTERS */}
                    {receiptSubTab === 'printers' && (
                      <div className="space-y-4 font-sans text-app-text">
                        {/* Connection status header card */}
                        <div className="p-3.5 rounded-2xl bg-app-bg border border-app-border flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`p-2.5 rounded-xl shrink-0 ${
                                printerConnState === 'Connected'
                                  ? 'bg-emerald-500/15 text-emerald-500'
                                  : printerConnState === 'Failed'
                                  ? 'bg-red-500/15 text-red-500'
                                  : printerConnState === 'Connecting' ||
                                    printerConnState === 'Printing'
                                  ? 'bg-amber-500/15 text-amber-500 '
                                  : printerConnState === 'Scanning'
                                  ? 'bg-blue-500/15 text-blue-500 '
                                  : 'bg-slate-500/15 text-slate-500'
                              }`}
                            >
                              <Printer size={18} />
                            </div>
                            <div>
                              <span className="text-[8px] text-app-text-muted font-bold uppercase tracking-wider block">
                                Connection State
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    printerConnState === 'Connected'
                                      ? 'bg-emerald-500 animate-ping'
                                      : printerConnState === 'Failed'
                                      ? 'bg-red-500'
                                      : printerConnState === 'Connecting' ||
                                        printerConnState === 'Printing'
                                      ? 'bg-amber-500 animate-ping'
                                      : printerConnState === 'Scanning'
                                      ? 'bg-blue-500 animate-ping'
                                      : 'bg-slate-500'
                                  }`}
                                />
                                <h4 className="text-[11px] font-extrabold uppercase tracking-wide">
                                  {printerConnState === 'Printing'
                                    ? 'Sending ESC/POS...'
                                    : printerConnState}
                                </h4>
                              </div>
                              {printerService.getConnectedPrinter() && (
                                <span className="text-[9.5px] text-app-text-muted block mt-0.5 font-bold font-mono">
                                  Active:{' '}
                                  {printerService.getConnectedPrinter()?.name}
                                  {printerService.getConnectedPrinter()
                                    ?.batteryLevel !== undefined &&
                                    ` (🔋 ${
                                      printerService.getConnectedPrinter()
                                        ?.batteryLevel
                                    }%)`}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                printerService.scan();
                                showToast(
                                  'Hardware Scanner',
                                  'Searching for nearby Bluetooth ESC/POS printers...',
                                  undefined,
                                  'info',
                                );
                              }}
                              disabled={
                                printerConnState === 'Scanning' ||
                                printerConnState === 'Connecting' ||
                                printerConnState === 'Printing'
                              }
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black rounded-xl text-[10.5px] cursor-pointer transition flex items-center gap-1 uppercase tracking-wider shrink-0 animate-fade-in"
                            >
                              <RefreshCw
                                size={11}
                                className={
                                  printerConnState === 'Scanning'
                                    ? 'animate-spin'
                                    : ''
                                }
                              />
                              <span>Scan Printers</span>
                            </button>
                          </div>
                        </div>

                        {/* Device scanning result list */}
                        <div className="space-y-2">
                          <label className="text-[9px] font-black text-app-text-muted uppercase tracking-wider block">
                            Discovered Devices ({discoveredPrinters.length})
                          </label>
                          {discoveredPrinters.length === 0 ? (
                            <div className="p-5 text-center bg-app-bg/50 border border-app-border border-dashed rounded-2xl text-[10.5px] text-app-text-muted font-bold">
                              {printerConnState === 'Scanning'
                                ? 'Searching for serial transmitters...'
                                : 'No devices listed. Check device Bluetooth is ON and click Scan Printers.'}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
                              {discoveredPrinters.map((dev) => {
                                const isActive =
                                  printerService.getConnectedPrinter()
                                    ?.address === dev.address;
                                const isConnected =
                                  isActive && printerConnState === 'Connected';
                                return (
                                  <div
                                    key={dev.address}
                                    className="p-3 bg-app-bg border border-app-border/80 rounded-xl flex items-center justify-between gap-3 shadow-xs"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-[10px] text-app-text font-black truncate">
                                          {dev.name}
                                        </span>
                                        {dev.isSaved && (
                                          <span className="text-[7.5px] font-black uppercase bg-amber-500/10 border border-amber-500/20 text-amber-500 px-1 py-0.2 rounded">
                                            Saved
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[9px] text-app-text-muted font-mono block mt-0.5 truncate">
                                        {dev.address}
                                      </span>
                                      {dev.signalStrength !== undefined && (
                                        <span className="text-[8px] text-app-text-muted block mt-0.5">
                                          RSSI: {dev.signalStrength} dBm
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {isConnected ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              printerService.disconnect();
                                              showToast(
                                                'Printer Service',
                                                'Thermal printer disconnected.',
                                                undefined,
                                                'info',
                                              );
                                            }}
                                            className="px-2 py-1 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 text-red-500 text-[8.5px] font-bold rounded-lg cursor-pointer transition uppercase"
                                          >
                                            Disconnect
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              printerService.forget();
                                              showToast(
                                                'Printer Service',
                                                'Printer credentials forgotten.',
                                                undefined,
                                                'info',
                                              );
                                            }}
                                            className="p-1 bg-app-card hover:bg-app-border border border-app-border rounded-lg text-app-text-muted hover:text-red-500 cursor-pointer transition"
                                            title="Forget device"
                                          >
                                            <X size={11} />
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            const success =
                                              await printerService.connect(dev);
                                            if (success) {
                                              showToast(
                                                'Connection Success',
                                                `Connected to ${dev.name}!`,
                                                undefined,
                                                'success',
                                              );
                                            } else {
                                              showToast(
                                                'Connection Failed',
                                                `Failed to establish GATT sync channel with ${dev.name}.`,
                                                undefined,
                                                'error',
                                              );
                                            }
                                          }}
                                          disabled={
                                            printerConnState === 'Connecting' ||
                                            printerConnState === 'Printing'
                                          }
                                          className="px-2 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-[8.5px] font-black rounded-lg cursor-pointer transition uppercase"
                                        >
                                          Connect
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Printer Parameters Configuration Form */}
                        <div className="border-t border-app-border/40 pt-3.5 space-y-3.5">
                          <h4 className="text-[10px] font-black text-app-text-muted uppercase tracking-wider block">
                            Layout & Roll Spacing Configurations
                          </h4>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">
                                Paper Width
                              </label>
                              <SearchableDropdown
                                items={[
                                  { id: '58mm', label: '58mm Roll (Receipt width)' },
                                  { id: '80mm', label: '80mm Roll (Wide width)' }
                                ]}
                                selectedValue={printerConfig.paperWidth}
                                onChange={(val) => {
                                  handleSavePrinterConfig({
                                    paperWidth: val as any,
                                    charactersPerLine: val === '58mm' ? 32 : 42,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Width set to ${val}. Auto-calibrated standard grid columns.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                placeholder="Select paper width..."
                              />
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">
                                Characters Per Line (CPL)
                              </label>
                              <input
                                type="number"
                                value={printerConfig.charactersPerLine}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 32;
                                  handleSavePrinterConfig({
                                    charactersPerLine: val,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Text margin size set to ${val} columns.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-bold"
                                placeholder="32 or 42"
                                min={10}
                                max={100}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">
                                Copies
                              </label>
                              <input
                                type="number"
                                value={printerConfig.copies}
                                onChange={(e) => {
                                  const val = Math.max(
                                    1,
                                    parseInt(e.target.value) || 1,
                                  );
                                  handleSavePrinterConfig({ copies: val });
                                  showToast(
                                    'Printer Settings',
                                    `Prints set to ${val} copies.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-bold"
                                min={1}
                                max={5}
                              />
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">
                                Print Density
                              </label>
                              <SearchableDropdown
                                items={[
                                  { id: '1', label: 'Light (1)' },
                                  { id: '2', label: 'Medium-Light (2)' },
                                  { id: '3', label: 'Standard (3)' },
                                  { id: '4', label: 'Medium-Dark (4)' },
                                  { id: '5', label: 'Dark (5)' }
                                ]}
                                selectedValue={String(printerConfig.printDensity)}
                                onChange={(val) => {
                                  const densityVal = parseInt(val) || 3;
                                  handleSavePrinterConfig({
                                    printDensity: densityVal,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Solenoid density scale set to ${val}/5.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                placeholder="Select print density..."
                              />
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider">
                                Timeout (ms)
                              </label>
                              <input
                                type="number"
                                value={printerConfig.connectionTimeout}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 10000;
                                  handleSavePrinterConfig({
                                    connectionTimeout: val,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Timeout set to ${val}ms.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                                step={1000}
                                min={2000}
                              />
                            </div>
                          </div>

                          {/* Interactive toggle settings */}
                          <div className="bg-app-bg/60 p-3 rounded-2xl border border-app-border/80 flex flex-col gap-2.5">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <span className="font-extrabold text-app-text text-[10.5px] block">
                                  Auto Cut Paper
                                </span>
                                <span className="text-[8.5px] text-app-text-muted mt-0.2 block">
                                  Send hardware feed cut commands after
                                  printing.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal =
                                    !printerConfig.isAutoCutEnabled;
                                  handleSavePrinterConfig({
                                    isAutoCutEnabled: nextVal,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Auto cut ${
                                      nextVal ? 'enabled' : 'disabled'
                                    }.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                  printerConfig.isAutoCutEnabled
                                    ? 'bg-amber-500'
                                    : 'bg-app-border'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white dark:bg-slate-900 shadow transition duration-200 ease-in-out ${
                                    printerConfig.isAutoCutEnabled
                                      ? 'translate-x-3'
                                      : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>

                            <div className="border-t border-app-border/40 my-0.5" />

                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <span className="font-extrabold text-app-text text-[10.5px] block">
                                  Auto Reconnect
                                </span>
                                <span className="text-[8.5px] text-app-text-muted mt-0.2 block">
                                  Retry background connection if printer goes
                                  offline.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !printerConfig.autoReconnect;
                                  handleSavePrinterConfig({
                                    autoReconnect: nextVal,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Auto reconnect ${
                                      nextVal ? 'enabled' : 'disabled'
                                    }.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                  printerConfig.autoReconnect
                                    ? 'bg-amber-500'
                                    : 'bg-app-border'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white dark:bg-slate-900 shadow transition duration-200 ease-in-out ${
                                    printerConfig.autoReconnect
                                      ? 'translate-x-3'
                                      : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>

                            <div className="border-t border-app-border/40 my-0.5" />

                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <span className="font-extrabold text-app-text text-[10.5px] block">
                                  Print Store Logo
                                </span>
                                <span className="text-[8.5px] text-app-text-muted mt-0.2 block">
                                  Include simulated text logo in header.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !printerConfig.printLogo;
                                  handleSavePrinterConfig({
                                    printLogo: nextVal,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Logo printing ${
                                      nextVal ? 'enabled' : 'disabled'
                                    }.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                  printerConfig.printLogo
                                    ? 'bg-amber-500'
                                    : 'bg-app-border'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white dark:bg-slate-900 shadow transition duration-200 ease-in-out ${
                                    printerConfig.printLogo
                                      ? 'translate-x-3'
                                      : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>

                            <div className="border-t border-app-border/40 my-0.5" />

                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <span className="font-extrabold text-app-text text-[10.5px] block">
                                  Print QR Codes
                                </span>
                                <span className="text-[8.5px] text-app-text-muted mt-0.2 block">
                                  Print ESC/POS model-2 QR codes for receipts.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !printerConfig.printQrCode;
                                  handleSavePrinterConfig({
                                    printQrCode: nextVal,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `QR Code printing ${
                                      nextVal ? 'enabled' : 'disabled'
                                    }.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                  printerConfig.printQrCode
                                    ? 'bg-amber-500'
                                    : 'bg-app-border'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white dark:bg-slate-900 shadow transition duration-200 ease-in-out ${
                                    printerConfig.printQrCode
                                      ? 'translate-x-3'
                                      : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>

                            <div className="border-t border-app-border/40 my-0.5" />

                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <span className="font-extrabold text-app-text text-[10.5px] block">
                                  Print Barcodes
                                </span>
                                <span className="text-[8.5px] text-app-text-muted mt-0.2 block">
                                  Print ESC/POS standard barcode codes.
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = !printerConfig.printBarcode;
                                  handleSavePrinterConfig({
                                    printBarcode: nextVal,
                                  });
                                  showToast(
                                    'Printer Settings',
                                    `Barcode printing ${
                                      nextVal ? 'enabled' : 'disabled'
                                    }.`,
                                    undefined,
                                    'info',
                                  );
                                }}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                  printerConfig.printBarcode
                                    ? 'bg-amber-500'
                                    : 'bg-app-border'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white dark:bg-slate-900 shadow transition duration-200 ease-in-out ${
                                    printerConfig.printBarcode
                                      ? 'translate-x-3'
                                      : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>

                          {/* Test print execution triggers */}
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await printerService.testPrint();
                                if (ok) {
                                  showToast(
                                    'Print Test Log',
                                    'Test print queue event dispatched.',
                                    undefined,
                                    'success',
                                  );
                                } else {
                                  showToast(
                                    'Print Test Error',
                                    'Connect a thermal printer before testing printer commands.',
                                    undefined,
                                    'error',
                                  );
                                }
                              }}
                              disabled={printerConnState !== 'Connected'}
                              className="w-full py-2 bg-slate-900 hover:bg-slate-850 disabled:opacity-40 disabled:hover:bg-slate-900 text-amber-500 font-extrabold rounded-xl border border-amber-500/20 text-xs transition cursor-pointer text-center uppercase tracking-wide"
                            >
                              Execute Test Print
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section Divider */}

            

              {/* Supabase & Cloud Database Integrations (Admins & Owners only) */}
              {hasRolePermission(currentRole, 'settings.integrations') &&
                configManager.getActiveEnvironment() === 'Developer Mode' && (
                  <div id="database-integrations-card" className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm animate-fade-in">
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
                        <button
                          type="button"
                          onClick={() => {
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
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            dbSyncEnabled ? 'bg-amber-500' : 'bg-app-border'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-slate-900 shadow-lg ring-0 transition duration-200 ease-in-out ${
                              dbSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
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
                          <button
                            type="button"
                            onClick={() => setShowKeyPass(!showKeyPass)}
                            className="text-amber-500 hover:underline"
                          >
                            {showKeyPass ? 'Hide' : 'Show'}
                          </button>
                        </label>
                        <input
                          type={showKeyPass ? 'text' : 'password'}
                          value={supabaseKey}
                          onChange={(e) => setSupabaseKey(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                          className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                        />
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
                          <button
                            type="button"
                            onClick={() => setShowDbPass(!showDbPass)}
                            className="text-amber-500 hover:underline"
                          >
                            {showDbPass ? 'Hide' : 'Show'}
                          </button>
                        </label>
                        <input
                          type={showDbPass ? 'text' : 'password'}
                          value={dbPass}
                          onChange={(e) => setDbPass(e.target.value)}
                          placeholder="Your Database Password"
                          className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

              {/* Centralized Device Hardware Permissions Card */}
              {hasRolePermission(currentRole, 'settings.view') && (
                <div id="device-permissions-manager-card" className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-amber-500" />
                      <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">
                        Device Permissions Manager
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={checkAllDevicePermissions}
                      className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 flex items-center gap-1 cursor-pointer transition"
                    >
                      <RefreshCw size={8} />
                      <span>Scan Sensors</span>
                    </button>
                  </div>

                  <p className="text-[10px] text-app-text-muted font-medium leading-relaxed">
                    Centralized dashboard managing hardware permissions for
                    cameras, location sensors, push notifications, and local
                    offline database persistent caches.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-1">
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
                          className="flex items-center justify-between gap-3 p-3 bg-app-bg/50 border border-app-border/70 rounded-2xl shadow-xs hover:border-app-border transition"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="p-2 bg-amber-500/10 rounded-xl text-amber-500 shrink-0">
                              {getPermissionIcon(type)}
                            </div>
                            <div className="min-w-0">
                              <span className="font-extrabold text-[10.5px] text-app-text block leading-tight truncate">
                                {meta.label}
                              </span>
                              <span className="text-[8.5px] text-app-text-muted font-medium block leading-tight truncate mt-0.5">
                                {meta.description}
                              </span>
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center">
                            {status === 'granted' && (
                              <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider">
                                <Check size={10} />
                                <span>Granted</span>
                              </div>
                            )}

                            {status === 'prompt' && (
                              <button
                                type="button"
                                onClick={() => setExplainingPermission(type)}
                                className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-[9px] font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <span>Request</span>
                              </button>
                            )}

                            {status === 'denied' && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isCapacitor) {
                                      openDeviceSettings();
                                    } else {
                                      setShowWebSettingsGuide(true);
                                    }
                                  }}
                                  className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-lg text-[8px] font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-1"
                                >
                                  <span>Blocked</span>
                                </button>
                              </div>
                            )}

                            {status === 'unsupported' && (
                              <div className="bg-app-border text-app-text-muted px-2 py-1 rounded-xl text-[8.5px] font-bold uppercase tracking-wider">
                                Unsupported
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
             {/* 4. OPERATOR SESSION (Available to all) */}
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
                    className="w-full py-2.5 bg-red-550 hover:bg-red-650 text-white font-black rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider text-[10px]"
                  >
                    <LogOut size={13} />
                    <span>Log Out of Account</span>
                  </button>
                </div>
              </div>
          </>
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
