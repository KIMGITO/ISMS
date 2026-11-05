// src/components/WhatsAppSettingsPanel.tsx
// Optional WhatsApp Cloud API connection. The access token is write-only here.

import React, { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { SupabaseService } from '../services/supabaseService';
import { useAppStore } from '../stores/appStore';
import { toUserMessage } from '../utils/userError';

const inputClass = 'bg-app-bg border border-app-border rounded-xl px-3 py-2 text-xs text-app-text';

export default function WhatsAppSettingsPanel({ businessId }: { businessId: string }) {
  const { showToast } = useAppStore();
  const [enabled, setEnabled] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('en');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    SupabaseService.callEdgeFunction('whatsapp-config', { action: 'get', businessId })
      .then(({ config }) => {
        setEnabled(config.enabled);
        setPhoneNumberId(config.phoneNumberId);
        setHasToken(config.hasToken);
        setTemplateName(config.templateName);
        setTemplateLanguage(config.templateLanguage);
      })
      .catch((err) => console.error('Could not load WhatsApp settings:', err));
  }, [businessId]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await SupabaseService.callEdgeFunction('whatsapp-config', {
        action: 'save',
        businessId,
        config: { enabled, phoneNumberId, accessToken, templateName, templateLanguage },
      });
      if (accessToken) setHasToken(true);
      setAccessToken('');
      showToast('WhatsApp Saved', 'Your WhatsApp settings are saved.', undefined, 'success');
    } catch (err) {
      showToast('Could Not Save', toUserMessage(err, 'Please try again.'), undefined, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="whatsapp-config-card" className="bg-app-card border border-app-border rounded-3xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <MessageCircle size={16} className="text-amber-500 shrink-0" />
        <h3 className="text-xs font-bold text-app-text">WhatsApp API (optional)</h3>
      </div>
      <p className="text-xs text-app-text-muted">
        When this is off, staff open each WhatsApp chat by hand. WhatsApp requires an approved template to
        message customers who haven't written in the last 24 hours.
      </p>
      <label className="flex items-center gap-2 text-xs font-medium text-app-text">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Send messages automatically through WhatsApp
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-app-text">
        Phone number ID
        <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-app-text">
        Access token
        <input
          type="password"
          autoComplete="off"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={hasToken ? 'Saved. Enter a new one to replace it.' : ''}
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-app-text">
          Approved template name
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-app-text">
          Template language
          <input value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} className={inputClass} />
        </label>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        className="self-start px-4 py-2 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save WhatsApp settings'}
      </button>
    </div>
  );
}
