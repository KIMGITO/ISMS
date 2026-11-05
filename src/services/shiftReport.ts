import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationService } from './notifications/notificationService';

/** Closes the active shift and sends the end-of-shift report to the owners. */
export async function finishShift(reportText: string, customMessage: string): Promise<void> {
  const { currentEmployee: employee, punchOut } = useAuthStore.getState();

  const closed = await punchOut();
  if (!closed) return;

  useNotificationStore.getState().showToast('Shift Ended', 'End of shift report sent to owners.', undefined, 'success');

  // This saves to the database for the Owner's notification feed AND triggers FCM Push
  NotificationService.createNotification(
    'Custom Notification',
    { message: `Shift Ended by ${employee?.name || 'Staff'}.${customMessage ? '\nNotes: ' + customMessage : ''}` },
    {
      title: `Shift Closed: ${employee?.name || 'Staff'}`,
      role: 'Owner',
      priority: 'high',
      payloadExtra: {
        reportText,
        customMessage,
        employeeName: employee?.name || 'Staff',
        employeeId: employee?.id || '',
        closedAt: new Date().toISOString(),
      },
    },
  );
}
