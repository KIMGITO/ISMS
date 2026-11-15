// src/services/problemReportService.ts
// Owners and admins report a problem to the developer. The ops-alert function saves the
// report and sends it to the developer's Telegram. Personal details are scrubbed here
// first, the same way crash reports are.
import { Capacitor } from '@capacitor/core';
import { getSupabase } from './supabaseClient';
import { scrubPersonalData } from './crashReporter';
import { useUiStore } from '../stores/uiStore';

export type ProblemSeverity = 'blocking' | 'broken' | 'minor';

export const SEVERITY_LABEL: Record<ProblemSeverity, string> = {
  blocking: "We can't work",
  broken: 'Something is wrong',
  minor: 'Small issue or idea',
};

export interface ProblemReport {
  businessId: string;
  severity: ProblemSeverity;
  summary: string;
  details: string;
}

/** Returns the report's reference number, or throws with a message the user can read. */
export async function sendProblemReport(report: ProblemReport): Promise<string> {
  const { data, error } = await getSupabase().functions.invoke('ops-alert', {
    body: {
      action: 'report',
      businessId: report.businessId,
      severity: report.severity,
      summary: scrubPersonalData(report.summary.trim()).slice(0, 200),
      details: scrubPersonalData(report.details.trim()).slice(0, 4000),
      screen: useUiStore.getState().activeTab,
      platform: Capacitor.getPlatform(),
      appVersion: __APP_VERSION__,
      appCommit: __APP_COMMIT__,
    },
  });
  if (error) {
    const serverMessage = await (error as any).context?.json?.().then((d: any) => d?.error).catch(() => null);
    throw new Error(
      serverMessage
        || (navigator.onLine ? "The report couldn't be sent. Please try again in a minute." : "You're offline. Connect and try again."),
    );
  }
  return String(data?.reference ?? '');
}
