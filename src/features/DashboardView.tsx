import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import OnlineStoreAlerts from '../components/OnlineStoreAlerts';
import { useNotificationStore } from '../stores/notificationStore';
import {
  LogOut,
  Calendar as CalendarIcon,
  Clock,
  Award,
  Shield,
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Filter,
  User,
  CalendarRange,
  MapPin,
  Zap,
  AlertCircle,
  Copy,
  HelpCircle,
  Pencil,
  Minimize2,
  Maximize2,
  ShieldAlert,
  CheckCircle2,
  Activity,
  TrendingUp,
  Thermometer,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  ShoppingBag,
  AlarmClock,
  BellRing,
  Loader2,
  Check,
  X,
} from 'lucide-react';
import AlarmTimePicker from '../components/AlarmTimePicker';
import {
  formatClock,
  formatDay,
  fromDateKey,
  minutesFromNow,
  relativeDay,
  toDateKey,
  untilText,
} from '../utils/timeFormat';
import { SupabaseService } from '../services/supabaseService';
import { useBusinessStore } from '../stores/businessStore';
import SearchableDropdown from '../components/SearchableDropdown';
import { useInventoryStore } from '../stores/inventoryStore';
import { useTransactionStore } from '../stores/transactionStore';
import { hasRolePermission, PermissionCode } from '../utils/permissions';
import EndShiftModal from '../components/EndShiftModal';
import NotificationService from '../services/notifications/notificationService';
import { useAuthStore } from '../stores/authStore';
import { Checkbox } from '../components/shared/Checkbox';

interface Schedule {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeIds?: string[];
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM, the time the alarm goes off
  repeat: 'None' | 'Daily' | 'Weekly' | 'Monthly';
  notes?: string;
  color: string;
  /** Last day (YYYY-MM-DD) the alarm went off. */
  lastRemindedOn: string | null;
}

const REPEAT_LABEL: Record<Schedule['repeat'], string> = {
  None: 'Once',
  Daily: 'Every day',
  Weekly: 'Every week',
  Monthly: 'Every month',
};

/** The next whole 5 minutes from now, at least 5 minutes away. */
const defaultAlarm = () => {
  const now = new Date();
  const ahead = 5 + (5 - (now.getMinutes() % 5)) % 5;
  return minutesFromNow(ahead, now);
};

const ROLE_SENIORITY: Record<string, number> = {
  Owner: 4,
  Admin: 3,
  Manager: 3,
  Cashier: 2,
  Rider: 1,
};

export default function DashboardView() {
  const {
    currentEmployee,
    employees,
    logout,
    activeShift,
    punchIn,
    punchOut,
    showToast,
    setActiveTab,
  } = useAppStore();

  const { products } = useInventoryStore();
  const { transactions } = useTransactionStore();

  const [isEndShiftModalOpen, setIsEndShiftModalOpen] = useState(false);

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const { activeBusinessId } = useBusinessStore();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [isCalendarCollapsed, setIsCalendarCollapsed] = useState(
    () => localStorage.getItem('kkm_calendar_collapsed') === 'true',
  );
  const [isHubExpanded, setIsHubExpanded] = useState(false);
  // Schedule creation form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [targetEmployeeIds, setTargetEmployeeIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState(() => defaultAlarm().time);
  const [formDate, setFormDate] = useState(() => toDateKey(new Date()));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Re-render every 30 s so "rings in 5 min" and "rang" stay current.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const [repeat, setRepeat] = useState<'None' | 'Daily' | 'Weekly' | 'Monthly'>('None');
  const [notes, setNotes] = useState('');
  const [formColor, setFormColor] = useState('#f59e0b');

  // Filter schedules by worker
  const [filterEmployeeId, setFilterEmployeeId] = useState('all');

  // Helper: map a DbSchedule row to the local Schedule shape
  const mapDbSchedule = (s: import('../types').DbSchedule): Schedule => {
    const emp = employees.find((e) => e.id === s.employeeId);
    return {
      id: s.id,
      employeeId: s.employeeId,
      employeeName: emp?.name || '',
      employeeIds: [s.employeeId],
      title: s.title,
      date: s.date,
      startTime: s.startTime.slice(0, 5), // trim seconds if present
      repeat: s.repeat as 'None' | 'Daily' | 'Weekly' | 'Monthly',
      notes: s.notes || '',
      color: s.color,
      lastRemindedOn: s.lastRemindedOn,
    };
  };

  useEffect(() => {
    if (currentEmployee && targetEmployeeIds.length === 0) {
      setTargetEmployeeIds([currentEmployee.id]);
    }
  }, [currentEmployee]);

  // Online/offline detection
  useEffect(() => {
    const updateStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  // Fetch schedules from Supabase + set up real-time subscription
  useEffect(() => {
    if (!activeBusinessId) return;

    // Initial load
    SupabaseService.fetchSchedules(activeBusinessId)
      .then((rows) => setSchedules(rows.map(mapDbSchedule)))
      .catch((err) => {
        console.error('Failed to load schedules', err);
        showToast('Error', 'Could not load schedule data.');
      });

    // Real-time subscription
    const channel = SupabaseService.subscribeToSchedules(
      activeBusinessId,
      // INSERT
      (row) =>
        setSchedules((prev) => [
          ...prev.filter((s) => s.id !== row.id),
          mapDbSchedule(row),
        ]),
      // UPDATE
      (row) =>
        setSchedules((prev) =>
          prev.map((s) => (s.id === row.id ? mapDbSchedule(row) : s)),
        ),
      // DELETE
      (id) => setSchedules((prev) => prev.filter((s) => s.id !== id)),
    );

    return () => {
      channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusinessId]);

  // Reminder: show toast for schedules due today or tomorrow
  // Only fires for the logged-in employee's own schedules.
  useEffect(() => {
    if (schedules.length === 0 || !currentEmployee) return;
    const todayStr = toDateKey(new Date());
    const tomorrowStr = toDateKey(new Date(Date.now() + 86400000));
    const todaySchedules = schedules.filter(
      (s) => s.date === todayStr && s.employeeId === currentEmployee.id,
    );
    const tomorrowSchedules = schedules.filter(
      (s) => s.date === tomorrowStr && s.employeeId === currentEmployee.id,
    );
    if (todaySchedules.length > 0) {
      showToast(
        '🔔 Reminders Today',
        `${todaySchedules.length} reminder${
          todaySchedules.length > 1 ? 's' : ''
        } set for you today, first at ${formatClock(
          [...todaySchedules].sort((a, b) => a.startTime.localeCompare(b.startTime))[0].startTime,
        )}.`,
        undefined,
        'info' as any,
      );
    } else if (tomorrowSchedules.length > 0) {
      showToast(
        '📅 Reminder',
        `${tomorrowSchedules.length} reminder${
          tomorrowSchedules.length > 1 ? 's' : ''
        } set for you tomorrow.`,
        undefined,
        'info' as any,
      );
    }
    // Only fire once after initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules.length > 0]);

  if (!currentEmployee) return null;

  const toggleCalendarCollapsed = () => {
    const nextVal = !isCalendarCollapsed;
    setIsCalendarCollapsed(nextVal);
    localStorage.setItem('kkm_calendar_collapsed', String(nextVal));
  };

  const getDaysInWeekOfDate = (baseDate: Date) => {
    const days = [];
    const temp = new Date(baseDate);
    const dayOfWeek = temp.getDay();
    // Move to Sunday of that week
    temp.setDate(temp.getDate() - dayOfWeek);
    for (let i = 0; i < 7; i++) {
      days.push(new Date(temp));
      temp.setDate(temp.getDate() + 1);
    }
    return days;
  };

  const resetForm = () => {
    setTitle('');
    setNotes('');
    setRepeat('None');
    setFormError(null);
    setEditingScheduleId(null);
    setShowAddForm(false);
  };

  const openCreateForm = () => {
    const next = defaultAlarm();
    setEditingScheduleId(null);
    setTitle('');
    setNotes('');
    setRepeat('None');
    setFormError(null);
    setTargetEmployeeIds([currentEmployee.id]);
    // A day picked in the calendar keeps the suggested time; today may roll to tomorrow near midnight.
    const pickedKey = toDateKey(selectedDate);
    setFormDate(pickedKey === toDateKey(new Date()) ? next.date : pickedKey);
    setStartTime(next.time);
    setShowAddForm(true);
  };

  const handleEditScheduleStart = (ev: Schedule) => {
    setEditingScheduleId(ev.id);
    setTitle(ev.title);
    setTargetEmployeeIds(
      ev.employeeIds && ev.employeeIds.length > 0
        ? ev.employeeIds
        : [ev.employeeId],
    );
    setStartTime(ev.startTime);
    // Editing keeps the day it was set for (a repeating alarm keeps its first day).
    setFormDate(ev.date);
    setRepeat(ev.repeat || 'None');
    setNotes(ev.notes || '');
    setFormColor(ev.color || '#f59e0b');
    setFormError(null);
    setConfirmDeleteId(null);
    setShowAddForm(true);
  };

  /** Adds or replaces rows straight away, so the list doesn't wait for real-time. */
  const upsertLocal = (rows: import('../types').DbSchedule[]) =>
    setSchedules((prev) => {
      const next = [...prev];
      for (const row of rows) {
        const mapped = mapDbSchedule(row);
        const i = next.findIndex((s) => s.id === row.id);
        if (i >= 0) next[i] = mapped;
        else next.push(mapped);
      }
      return next;
    });

  /** "Rings at 1:38 PM today" or, for a time already passed with no repeat, a warning. */
  const ringPhrase = (date: string, time: string, rep: Schedule['repeat']) => {
    const at = `${formatClock(time)} ${relativeDay(date)}`;
    return rep === 'None' ? `Rings at ${at}.` : `Rings at ${formatClock(time)}, ${REPEAT_LABEL[rep].toLowerCase()} from ${formatDay(date)}.`;
  };

  const alarmTimeOf = (date: string, time: string) => {
    const d = fromDateKey(date);
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const handleCreateSchedule = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setFormError(null);
    const fail = (msg: string, heading = 'Check the reminder') => {
      setFormError(msg);
      showToast(heading, msg, undefined, 'error');
    };
    if (!title.trim()) return fail('Give the reminder a name, for example "Open the shop".');
    if (targetEmployeeIds.length === 0) return fail('Choose at least one person for this reminder.');
    if (!startTime) return fail('Pick the time it should ring.');
    if (repeat === 'None' && alarmTimeOf(formDate, startTime).getTime() <= Date.now()) {
      return fail(`${formatClock(startTime)} ${relativeDay(formDate)} has already passed. Pick a later time or a repeat.`);
    }

    // Role seniority / hierarchy check
    const isReminder = title.toLowerCase().includes('reminder');
    const creatorRole = currentEmployee.role;
    const creatorLevel = ROLE_SENIORITY[creatorRole] || 1;

    const invalidAssignees = targetEmployeeIds
      .map((id) => employees.find((e) => e.id === id))
      .filter((emp): emp is Exclude<typeof emp, undefined> => {
        if (!emp) return false;
        const empLevel = ROLE_SENIORITY[emp.role] || 1;
        return empLevel > creatorLevel;
      });

    if (invalidAssignees.length > 0 && !isReminder) {
      return fail(
        `As a ${creatorRole}, you can't set this for ${invalidAssignees
          .map((e) => `${e.name} (${e.role})`)
          .join(', ')} unless the name contains the word "reminder".`,
        'Not allowed',
      );
    }

    const assignedWorker =
      employees.find((emp) => emp.id === targetEmployeeIds[0]) ||
      currentEmployee;

    const shift = {
      title: title.trim(),
      notes: notes.trim(),
      date: formDate,
      startTime,
      repeat,
      color: formColor,
    };
    const when = ringPhrase(formDate, startTime, repeat);

    setSaving(true);
    try {
      if (editingScheduleId) {
        // The alarm being edited keeps its first person. Anyone added while editing gets their own copy.
        const updated = await SupabaseService.updateSchedule({ id: editingScheduleId, employeeId: targetEmployeeIds[0], endTime: null, ...shift });
        const added = await Promise.all(
          targetEmployeeIds.slice(1).map((employeeId) =>
            SupabaseService.createSchedule({ businessId: activeBusinessId, employeeId, createdBy: currentEmployee.id, ...shift }),
          ),
        );
        upsertLocal([updated, ...added]);
        showToast(
          'Reminder Updated',
          `"${shift.title}" ${when}${added.length ? ` Also set for ${added.length} more.` : ''}`,
          assignedWorker.avatar,
          'success',
        );
      } else {
        // One alarm per person, so each one hears their own.
        const results = await Promise.allSettled(
          targetEmployeeIds.map((employeeId) =>
            SupabaseService.createSchedule({ businessId: activeBusinessId, employeeId, createdBy: currentEmployee.id, ...shift }),
          ),
        );
        const saved = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        upsertLocal(saved);
        const failed = targetEmployeeIds.filter((_, i) => results[i].status === 'rejected');
        results.forEach((r) => r.status === 'rejected' && console.error(r.reason));
        if (failed.length > 0) {
          const names = failed.map((id) => employees.find((emp) => emp.id === id)?.name || 'one person').join(', ');
          // Keep the form open so the person can try again.
          setTargetEmployeeIds(failed);
          setSaving(false);
          return fail(
            `${saved.length ? `Saved for ${saved.length}, but not` : 'Not saved'} for ${names}. Check your connection and press Set reminder again.`,
            'Reminder Not Saved',
          );
        }
        showToast(
          'Reminder Set',
          `"${shift.title}" ${when}${targetEmployeeIds.length > 1 ? ` Set for ${targetEmployeeIds.length} people.` : ''}`,
          assignedWorker.avatar,
          'success',
        );
      }
      setSelectedDate(fromDateKey(formDate));
      setCurrentMonth(fromDateKey(formDate));
      resetForm();
    } catch (err) {
      console.error(err);
      fail('The reminder was not saved. Check your connection and try again.', 'Reminder Not Saved');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = async (id: string, name: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    try {
      await SupabaseService.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      showToast('Reminder Removed', `"${name}" won't ring any more.`, undefined, 'success');
      if (editingScheduleId === id) resetForm();
    } catch (err) {
      console.error(err);
      showToast('Error', 'The reminder was not removed. Check your connection and try again.', undefined, 'error');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const shiftSelectedDay = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d);
    setCurrentMonth(d);
  };

  const goToday = () => {
    setSelectedDate(new Date());
    setCurrentMonth(new Date());
  };

  /** Status of an alarm on the day shown: rang, rings in 10 min, or missed. */
  const ringStatus = (ev: Schedule, day: Date) => {
    const dayKey = toDateKey(day);
    const at = alarmTimeOf(dayKey, ev.startTime);
    const now = new Date();
    if (dayKey === toDateKey(now) && ev.lastRemindedOn === dayKey) return { label: 'Rang', tone: 'done' as const };
    if (at.getTime() > now.getTime()) {
      return dayKey === toDateKey(now)
        ? { label: `Rings ${untilText(at, now)}`, tone: 'soon' as const }
        : { label: 'Will ring', tone: 'later' as const };
    }
    return { label: 'Passed', tone: 'done' as const };
  };

  // Helper arrays for calendar grids
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  const prevMonthDays = getDaysInMonth(year, month - 1);

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  // List of calendar grid dates
  const gridCells: { date: Date; isCurrentMonth: boolean; key: string }[] = [];

  // Previous month overflow days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthDays - i);
    gridCells.push({
      date: d,
      isCurrentMonth: false,
      key: `prev-${prevMonthDays - i}`,
    });
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    gridCells.push({ date: d, isCurrentMonth: true, key: `curr-${i}` });
  }

  // Next month overflow days to pad grid to complete week row (6 rows * 7 days = 42 cells)
  const remainingCells = 42 - gridCells.length;
  for (let i = 1; i <= remainingCells; i++) {
    const d = new Date(year, month + 1, i);
    gridCells.push({ date: d, isCurrentMonth: false, key: `next-${i}` });
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    const nextDate = new Date(currentMonth);
    if (direction === 'prev') {
      nextDate.setMonth(nextDate.getMonth() - 1);
    } else {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }
    setCurrentMonth(nextDate);
  };

  const handleSelectGridDate = (d: Date) => {
    setSelectedDate(d);
  };

  const isSameDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const getEmployeeRole = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    return emp ? emp.role : '';
  };

  const canSeeEmployeeSchedule = (employeeId: string, employeeRole: string) => {
    const currentRole = currentEmployee.role;
    if (currentRole === 'Owner') {
      return true;
    }
    if (currentRole === 'Manager') {
      return employeeRole !== 'Owner';
    }
    if (currentRole === 'Cashier') {
      return employeeId === currentEmployee.id || employeeRole === 'Staff';
    }
    if (currentRole === 'Staff') {
      return employeeId === currentEmployee.id;
    }
    return employeeId === currentEmployee.id || employeeRole === 'Staff';
  };

  const canEditSchedule = (scheduleTitle: string, assignedIds: string[]) => {
    const isReminder = scheduleTitle.toLowerCase().includes('reminder');
    const currentRole = currentEmployee.role;
    const currentLevel = ROLE_SENIORITY[currentRole] || 1;

    // A user can edit if they are an Owner, or if they are editing a schedule with no senior assigned roles,
    // or if the schedule is classified as a "reminder"
    const hasSenior = assignedIds.some((id) => {
      const emp = employees.find((e) => e.id === id);
      if (!emp) return false;
      const empLevel = ROLE_SENIORITY[emp.role] || 1;
      return empLevel > currentLevel;
    });

    if (hasSenior && !isReminder) {
      return false;
    }
    return true;
  };

  const getSchedulesForDate = (date: Date) => {
  // Format local date to 'YYYY-MM-DD' without timezone shifting
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const targetStr = `${year}-${month}-${day}`;

  return schedules.filter((s) => {
    const assignedIds =
      s.employeeIds && s.employeeIds.length > 0
        ? s.employeeIds
        : [s.employeeId];

    const hasVisibleEmployee = assignedIds.some((empId) => {
      const sRole = getEmployeeRole(empId);
      return canSeeEmployeeSchedule(empId, sRole);
    });
    if (!hasVisibleEmployee) return false;

    // Filter by assigned employee
    if (filterEmployeeId !== 'all' && !assignedIds.includes(filterEmployeeId))
      return false;

    const parts = s.date.split('-');
    // Created in Local Time
    const scheduleStartDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

    // Normalize both dates to midnight (local time) for an accurate chronological comparison
    const normalizedTargetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    // Guard: Event cannot occur prior to its initial start date
    if (scheduleStartDate > normalizedTargetDate) return false;

    if (s.repeat === 'None') {
      return s.date === targetStr;
    }
    if (s.repeat === 'Daily') {
      return true;
    }
    if (s.repeat === 'Weekly') {
      // Both .getDay() calls now refer strictly to local time
      return normalizedTargetDate.getDay() === scheduleStartDate.getDay();
    }
    if (s.repeat === 'Monthly') {
      // Both .getDate() calls now refer strictly to local time
      return normalizedTargetDate.getDate() === scheduleStartDate.getDate();
    }

    return false;
  });
};
  const activeSchedulesForSelected = getSchedulesForDate(selectedDate);
  const canManageShifts = currentEmployee
    ? hasRolePermission(currentEmployee.role, 'staff.update')
    : false;

  const safeProducts = products || [];
  const safeTransactions = transactions || [];

  return (
    <div
      id="shifts-calendar-dashboard"
      className="h-full flex flex-col bg-app-bg font-sans overflow-hidden"
    >
      {!isOnline && (
        <div className="bg-red-500 text-white p-2 text-center font-bold">
          You are offline. Changes will be synced when connection is restored.
        </div>
      )}

      <div className="px-4 pt-4 empty:hidden">
        <OnlineStoreAlerts />
      </div>

      {/* Main Calendar Space */}
      <div className="flex-1 overflow-y-auto p-4 pb-nav grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column: Google-Like Calendar Grid */}
        <div className="lg:col-span-2 bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-4">
          {/* Month Header controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                <CalendarRange size={16} />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-app-text font-display">
                  {monthNames[month]} {year}
                </h3>
                <p className="text-[10px] text-app-text-muted font-medium">
                  Interactive Shift Planner
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleCalendarCollapsed}
                data-shortcut="toggle-month"
                title={isCalendarCollapsed ? 'Show the month (M)' : 'Show one week (M)'}
                className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded-lg border border-amber-500/25 transition cursor-pointer flex items-center gap-1 shrink-0 mr-1 text-[9px] font-black uppercase tracking-wider"
              >
                {isCalendarCollapsed ? (
                  <>
                    <Maximize2 size={11} />
                    <span className="hidden xs:inline">Expand</span>
                  </>
                ) : (
                  <>
                    <Minimize2 size={11} />
                    <span className="hidden xs:inline">Collapse</span>
                  </>
                )}
              </button>

              {!isCalendarCollapsed && (
                <>
                  <button
                    onClick={() => navigateMonth('prev')}
                    className="p-1.5 hover:bg-app-bg text-app-text rounded-lg border border-app-border transition cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={goToday}
                    className="px-2.5 py-1 text-[10px] font-bold bg-app-bg hover:bg-app-card text-app-text rounded-lg border border-app-border transition cursor-pointer"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => navigateMonth('next')}
                    className="p-1.5 hover:bg-app-bg text-app-text rounded-lg border border-app-border transition cursor-pointer"
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          {isCalendarCollapsed ? (
            /* COLLAPSED CALENDAR VIEW: WEEKLY STRIP GRID */
            <div className="flex flex-col gap-1 bg-app-bg/50 p-2 border border-app-border/45 rounded-2xl">
              <div className="text-[9px] text-app-text-muted font-black uppercase tracking-wider px-1">
                Weekly Operation View
              </div>
              <div className="grid grid-cols-7 gap-1.5 py-1">
                {getDaysInWeekOfDate(selectedDate).map((day) => {
                  const matchesSelected = isSameDay(day, selectedDate);
                  const matchesToday = isSameDay(day, new Date());
                  const hasEvents = getSchedulesForDate(day).length > 0;
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setSelectedDate(day)}
                      className={`py-2 px-1 rounded-xl border flex flex-col items-center justify-center gap-0.5 cursor-pointer transition select-none ${
                        matchesSelected
                          ? 'bg-amber-500/10 border-amber-500/40 text-amber-500'
                          : 'bg-app-bg border-app-border/40 hover:border-app-border text-app-text-muted'
                      }`}
                    >
                      <span className="text-[8px] font-bold uppercase tracking-wide opacity-60">
                        {
                          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
                            day.getDay()
                          ]
                        }
                      </span>
                      <span
                        className={`text-xs font-mono font-black ${
                          matchesToday
                            ? 'bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded-full text-[10px]'
                            : 'text-app-text'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                      {hasEvents && (
                        <span className="w-1 h-1 bg-amber-500 rounded-full mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* FULL MONTH CALENDAR VIEW GRID */
            <>
              {/* Day of Week Labels */}
              <div className="grid grid-cols-7 gap-1 text-center font-mono text-[9px] font-black text-app-text-muted uppercase tracking-widest border-b border-app-border pb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                  (day) => (
                    <span key={day} className="py-1">
                      {day}
                    </span>
                  ),
                )}
              </div>

              {/* Calendar Grid cells */}
              <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-[300px]">
                {gridCells.map(({ date, isCurrentMonth }) => {
                  const matchesSelected = isSameDay(date, selectedDate);
                  const hasEvents = getSchedulesForDate(date).length > 0;
                  const matchesToday = isSameDay(date, new Date());
                  const dateEvents = getSchedulesForDate(date);

                  return (
                    <div
                      key={date.toISOString()}
                      onClick={() => handleSelectGridDate(date)}
                      className={`min-h-[55px] p-1.5 rounded-xl border flex flex-col justify-between cursor-pointer transition select-none group relative ${
                        matchesSelected
                          ? 'bg-amber-500/10 border-amber-500/40'
                          : isCurrentMonth
                          ? 'bg-app-bg border-app-border/40 hover:border-app-border'
                          : 'bg-app-bg/40 border-app-border/20 text-app-text-muted/40'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span
                          className={`text-[10.5px] font-mono font-bold ${
                            matchesToday
                              ? 'bg-amber-500 text-slate-950 w-5 h-5 rounded-full flex items-center justify-center text-[10px]'
                              : matchesSelected
                              ? 'text-amber-500'
                              : 'text-app-text'
                          }`}
                        >
                          {date.getDate()}
                        </span>
                        {hasEvents && (
                          <span className="w-1.5 h-1.5 bg-amber-500 rounded-full " />
                        )}
                      </div>

                      {/* Micro list of events inside the cell */}
                      <div className="space-y-0.5 mt-1 overflow-hidden max-h-[25px]">
                        {dateEvents.slice(0, 2).map((ev) => (
                          <div
                            key={ev.id}
                            className="text-[7.5px] px-1 rounded truncate text-white leading-tight font-medium"
                            style={{ backgroundColor: ev.color }}
                          >
                            {ev.title}
                          </div>
                        ))}
                        {dateEvents.length > 2 && (
                          <div className="text-[7px] text-app-text-muted font-black text-right pr-0.5">
                            +{dateEvents.length - 2} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right column: Shift Details & Add Schedule panel */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* Operator Panel */}
          <div className="bg-app-card border border-app-border rounded-2xl p-3 shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={
                  currentEmployee.avatar ||
                  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23f59e0b'%3E%3Ccircle cx='50' cy='35' r='20'/%3E%3Cpath d='M20,80 C20,60 80,60 80,80'/%3E%3C/svg%3E"
                }
                alt={currentEmployee.name}
                className="w-8 h-8 rounded-xl object-cover border border-amber-500/10 shrink-0"
                referrerPolicy="no-referrer"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-black text-app-text truncate">
                    {currentEmployee.name}
                  </span>
                  <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded-full text-[7px] font-black uppercase tracking-wider shrink-0">
                    {currentEmployee.role}
                  </span>
                </div>
                <p className="text-[8.5px] text-app-text-muted truncate mt-0.5">
                  Terminal Active
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeShift ? (
                <button
                  onClick={() => setIsEndShiftModalOpen(true)}
                  data-shortcut="clock"
                  className="px-2 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[8.5px] font-black uppercase tracking-wider  flex items-center gap-1 transition cursor-pointer"
                  title="Punch Out"
                >
                  <Clock size={9} /> Stop
                </button>
              ) : (
                <button
                  onClick={punchIn}
                  data-shortcut="clock"
                  className="px-2 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-lg text-[8.5px] font-black uppercase tracking-wider flex items-center gap-1 transition cursor-pointer"
                  title="Punch In"
                >
                  <Zap size={9} /> Start
                </button>
              )}

              <button
                onClick={logout}
                className="p-1.5 bg-app-bg hover:bg-app-card text-red-500 border border-app-border rounded-lg transition cursor-pointer"
                title="Sign Out"
              >
                <LogOut size={10} />
              </button>
            </div>
          </div>

          {/* COMMAND CENTER */}
          

          {/* Schedule Assignment Creator */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-app-border/45 pb-2">
              <h3 className="text-xs font-black text-app-text uppercase tracking-wider flex items-center gap-1.5">
                <AlarmClock size={14} className="text-amber-500 -ml-1" />
                {editingScheduleId
                  ? 'Edit Reminder'
                  : canManageShifts
                  ? 'Set A Reminder'
                  : 'Set A Personal Reminder'}
              </h3>

              {!showAddForm && (
                <button
                  onClick={openCreateForm}
                  data-shortcut="new"
                  title="Set a reminder (N)"
                  className="px-2.5 py-1 bg-amber-500 text-slate-950 text-[10px] font-black rounded-lg transition hover:bg-amber-600 cursor-pointer flex items-center gap-1"
                >
                  <Plus size={11} /> New
                </button>
              )}
            </div>

            {showAddForm ? (
              <form
                onSubmit={handleCreateSchedule}
                onKeyDown={(e) => {
                  // The page keys don't work while typing, so the form has its own.
                  // A dropdown closing on Esc handles it first.
                  if (e.defaultPrevented) return;
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    resetForm();
                  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCreateSchedule();
                  }
                }}
                className="space-y-3 text-xs"
                aria-busy={saving}
              >
                <div className="space-y-1">
                  <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                    Ring at
                  </label>
                  <AlarmTimePicker
                    value={startTime}
                    onChange={(t) => {
                      setStartTime(t);
                      setFormError(null);
                    }}
                    onQuickPick={(date) => setFormDate(date)}
                    disabled={saving}
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="date"
                      aria-label="Day"
                      value={formDate}
                      disabled={saving}
                      onChange={(e) => {
                        if (e.target.value) setFormDate(e.target.value);
                        setFormError(null);
                      }}
                      className="bg-app-bg text-app-text px-2 py-1.5 rounded-lg border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                    />
                    <span className="text-[10px] text-app-text-muted font-medium">{formatDay(formDate)}</span>
                  </div>
                  <p className="text-[10.5px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 pt-0.5">
                    <BellRing size={11} /> {ringPhrase(formDate, startTime, repeat)}
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                    Reminder name
                  </label>
                  <input
                    type="text"
                    autoFocus
                    disabled={saving}
                    placeholder="e.g. Open the shop, Milk delivery route"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setFormError(null);
                    }}
                    className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                    Who it rings for
                  </label>
                  <p className="text-[9px] text-app-text-muted/80 font-normal leading-tight mb-1.5">
                    It rings on each person's phone until they tap Accept. You can't set
                    one for a more senior role unless the name contains the word "reminder".
                  </p>
                  <div className="flex flex-col gap-1 bg-app-bg border border-app-border p-2 rounded-xl max-h-[120px] overflow-y-auto">
                    {employees.map((emp) => {
                      const isSelected = targetEmployeeIds.includes(emp.id);
                      const creatorRole = currentEmployee.role;
                      const creatorLevel = ROLE_SENIORITY[creatorRole] || 1;
                      const empLevel = ROLE_SENIORITY[emp.role] || 1;
                      const isSenior = empLevel > creatorLevel;
                      const isReminder = title
                        .toLowerCase()
                        .includes('reminder');
                      const disabled = isSenior && !isReminder;

                      return (
                        <label
                          key={emp.id}
                          className={`flex items-center justify-between p-1.5 rounded-lg border transition text-[10.5px] cursor-pointer select-none ${
                            disabled
                              ? 'bg-red-500/5 border-red-500/10 opacity-50 cursor-not-allowed'
                              : isSelected
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                              : 'bg-app-card border-app-border hover:bg-app-bg text-app-text'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Checkbox
                              ariaLabel={`Choose ${emp.name}`}
                              disabled={disabled}
                              checked={isSelected && !disabled}
                              onChange={() => {
                                if (disabled) return;
                                if (isSelected) {
                                  setTargetEmployeeIds(
                                    targetEmployeeIds.filter(
                                      (id) => id !== emp.id,
                                    ),
                                  );
                                } else {
                                  setTargetEmployeeIds([
                                    ...targetEmployeeIds,
                                    emp.id,
                                  ]);
                                }
                              }}
                              className="shrink-0"
                            />
                            <span className="font-bold truncate max-w-[120px]">
                              {emp.name}
                            </span>
                            <span className="text-[8.5px] font-medium opacity-60">
                              ({emp.role})
                            </span>
                          </div>
                          {isSenior && (
                            <span className="text-[7.5px] font-black text-red-500 uppercase tracking-wider bg-red-500/10 px-1 rounded shrink-0">
                              Senior {isReminder ? '(Remind Ok)' : '(Locked)'}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                        Repeat
                    </label>
                    <SearchableDropdown
                      items={[
                        { id: 'None', label: 'Once' },
                        { id: 'Daily', label: 'Every day' },
                        { id: 'Weekly', label: 'Every week' },
                        { id: 'Monthly', label: 'Every month' },
                      ]}
                      selectedValue={repeat}
                      onChange={(val) =>
                        setRepeat(val as 'None' | 'Daily' | 'Weekly' | 'Monthly')
                      }
                      placeholder="Repeat..."
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                      Color category
                    </label>
                    <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[180px]">
                      {[
                        '#f59e0b',
                        '#10b981',
                        '#3b82f6',
                        '#ec4899',
                        '#8b5cf6',
                        '#ef4444',
                        '#06b6d4',
                        '#84cc16',
                        '#e11d48',
                        '#2563eb',
                        '#ea580c',
                        '#0d9488',
                        '#db2777',
                        '#4f46e5',
                        '#059669',
                        '#d97706',
                      ].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormColor(c)}
                          className={`w-4.5 h-4.5 rounded-full transition cursor-pointer ${
                            formColor === c
                              ? 'ring-2 ring-amber-500 scale-110 shadow-sm'
                              : 'scale-100 opacity-70 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                    Note (optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Shown when it rings, e.g. bring the float"
                    disabled={saving}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none resize-none"
                  />
                </div>
                {formError && (
                  <p role="alert" className="text-[10.5px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1.5">
                    {formError}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={saving}
                    title="Cancel (Esc)"
                    className="flex-1 py-2 bg-app-bg text-app-text border border-app-border font-bold rounded-xl transition hover:bg-app-card cursor-pointer text-center disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    title="Save (Ctrl+Enter)"
                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition cursor-pointer text-center flex items-center justify-center gap-1.5 disabled:opacity-70 disabled:cursor-wait"
                  >
                    {saving ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Saving…
                      </>
                    ) : editingScheduleId ? (
                      'Update Reminder'
                    ) : (
                      'Set Reminder'
                    )}
                  </button>
                </div>
                <p className="text-[9px] text-app-text-muted text-center">Esc to cancel · Ctrl+Enter to save</p>
              </form>
            ) : (
              <div className="text-center py-4 bg-app-bg border border-app-border/45 rounded-xl border-dashed">
                <p className="text-[10px] text-app-text-muted font-medium">
                  Press New (or N) to set a reminder for:
                </p>
                <span className="text-xs font-black text-amber-500 block mt-1">
                  {formatDay(selectedDate)}
                </span>
              </div>
            )}
          </div>

          {/* Active Shift List for the selected day */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex-1 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border/45 pb-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftSelectedDay(-1)}
                  data-shortcut="prev-day"
                  title="Previous day (←)"
                  aria-label="Previous day"
                  className="p-1 hover:bg-app-bg text-app-text rounded-lg border border-app-border transition cursor-pointer"
                >
                  <ChevronLeft size={12} />
                </button>
                <h3 className="text-xs font-black text-app-text tracking-wide flex items-center gap-1 px-1">
                  <CalendarIcon size={13} className="text-amber-500" />
                  {formatDay(selectedDate)}
                </h3>
                <button
                  type="button"
                  onClick={() => shiftSelectedDay(1)}
                  data-shortcut="next-day"
                  title="Next day (→)"
                  aria-label="Next day"
                  className="p-1 hover:bg-app-bg text-app-text rounded-lg border border-app-border transition cursor-pointer"
                >
                  <ChevronRight size={12} />
                </button>
                {toDateKey(selectedDate) !== toDateKey(new Date()) && (
                  <button
                    type="button"
                    onClick={goToday}
                    data-shortcut="today"
                    title="Go to today (T)"
                    className="ml-1 px-2 py-0.5 text-[9px] font-bold bg-app-bg hover:bg-app-card text-app-text rounded-lg border border-app-border transition cursor-pointer"
                  >
                    Today
                  </button>
                )}
              </div>

              {/* Quick Filter */}
              <div className="flex items-center gap-1.5 min-w-[135px]">
                <Filter size={11} className="text-app-text-muted shrink-0" />
                <div className="flex-1">
                  <SearchableDropdown
                    items={[
                      { id: 'all', label: 'All staff' },
                      ...employees.map((e) => ({
                        id: e.id,
                        label: e.name.split(' ')[0],
                      })),
                    ]}
                    selectedValue={filterEmployeeId}
                    onChange={(val) => setFilterEmployeeId(val)}
                    placeholder="Filter..."
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {activeSchedulesForSelected.length === 0 ? (
                <div className="py-8 text-center text-[10px] text-app-text-muted font-medium">
                  No reminders on this day.
                </div>
              ) : (
                [...activeSchedulesForSelected].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((ev) => {
                  const assignedIds =
                    ev.employeeIds && ev.employeeIds.length > 0
                      ? ev.employeeIds
                      : [ev.employeeId];
                  const canEdit = canEditSchedule(ev.title, assignedIds);
                  const status = ringStatus(ev, selectedDate);
                  const confirming = confirmDeleteId === ev.id;
                  const deleting = deletingId === ev.id;

                  return (
                    <div
                      key={ev.id}
                      className={`p-3 bg-app-bg border rounded-xl transition flex flex-col gap-1.5 relative group ${
                        editingScheduleId === ev.id ? 'border-amber-500/60' : 'border-app-border/40 hover:border-app-border/80'
                      } ${deleting ? 'opacity-50' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-2 pr-16">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: ev.color }}
                          />
                          <span className="text-sm font-black text-app-text font-mono shrink-0">
                            {formatClock(ev.startTime)}
                          </span>
                          <h4 className="text-xs font-bold text-app-text truncate">
                            {ev.title}
                          </h4>
                        </div>

                        <div className="flex items-center gap-1.5 absolute right-2.5 top-2.5 opacity-80 hover:opacity-100 transition-opacity">
                          {canEdit && confirming ? (
                            <>
                              <span className="text-[9px] font-bold text-red-500">Remove?</span>
                              <button
                                onClick={() => handleDeleteSchedule(ev.id, ev.title)}
                                disabled={deleting}
                                className="text-white bg-red-500 hover:bg-red-600 p-1 rounded-lg transition cursor-pointer disabled:cursor-wait"
                                title="Yes, remove"
                                aria-label="Yes, remove this reminder"
                              >
                                {deleting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deleting}
                                className="text-app-text-muted p-1 bg-app-card hover:bg-app-bg rounded-lg border border-app-border/40 transition cursor-pointer"
                                title="Keep it"
                                aria-label="Keep this reminder"
                              >
                                <X size={11} />
                              </button>
                            </>
                          ) : canEdit ? (
                            <>
                              <button
                                onClick={() => handleEditScheduleStart(ev)}
                                className="text-app-text-muted hover:text-amber-500 p-1 bg-app-card hover:bg-app-bg rounded-lg border border-app-border/40 transition cursor-pointer"
                                title="Edit reminder"
                                aria-label="Edit reminder"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                onClick={() => handleDeleteSchedule(ev.id, ev.title)}
                                className="text-app-text-muted hover:text-red-500 p-1 bg-app-card hover:bg-app-bg rounded-lg border border-app-border/40 transition cursor-pointer"
                                title="Remove reminder"
                                aria-label="Remove reminder"
                              >
                                <Trash2 size={11} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] text-app-text-muted font-medium border-t border-app-border/30 pt-1.5 mt-0.5">
                        <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                          <span className="text-[8px] uppercase tracking-wider font-extrabold text-amber-500/80">
                            Rings for
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {assignedIds.map((id) => {
                              const emp = employees.find((e) => e.id === id);
                              if (!emp) return null;
                              const isSelf = emp.id === currentEmployee.id;
                              return (
                                <span
                                  key={id}
                                  className="inline-flex items-center gap-1 bg-app-card px-1.5 py-0.5 rounded border border-app-border text-[9px] text-app-text font-bold"
                                >
                                  <span>{emp.name.split(' ')[0]}</span>
                                  {isSelf && (
                                    <span className="text-[7.5px] font-black text-emerald-500 bg-emerald-500/10 px-0.5 rounded">
                                      Me
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 justify-end col-span-2 sm:col-span-1 self-end">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              status.tone === 'soon'
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : status.tone === 'later'
                                ? 'bg-app-card text-app-text-muted border border-app-border'
                                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {status.label === 'Rang' ? <Check size={10} /> : <BellRing size={10} />}
                            {status.label}
                          </span>
                        </div>
                      </div>

                      {ev.notes && (
                        <p className="text-[9.5px] leading-relaxed text-app-text-muted bg-app-card border border-app-border/35 p-1.5 rounded-lg mt-0.5 font-sans font-medium">
                          {ev.notes}
                        </p>
                      )}

                      {ev.repeat !== 'None' && (
                        <span className="text-[8px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded self-start uppercase tracking-wider">
                          {REPEAT_LABEL[ev.repeat]}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Modals & Forms */}
      <EndShiftModal 
        isOpen={isEndShiftModalOpen} 
        onClose={() => setIsEndShiftModalOpen(false)} 
      />
    </div>
  );
}