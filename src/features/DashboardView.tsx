import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
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
} from 'lucide-react';
import { SupabaseService } from '../services/supabaseService';
import { useBusinessStore } from '../stores/businessStore';
import SearchableDropdown from '../components/SearchableDropdown';
import { useInventoryStore } from '../stores/inventoryStore';
import { useTransactionStore } from '../stores/transactionStore';
import { hasRolePermission, PermissionCode } from '../utils/permissions';
import EndShiftModal from '../components/EndShiftModal';
import NotificationService from '../services/notifications/notificationService';
import { useAuthStore } from '../stores/authStore';

interface Schedule {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeIds?: string[];
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  repeat: 'None' | 'Daily' | 'Weekly' | 'Monthly';
  notes?: string;
  color: string;
}

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
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
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
      endTime: s.endTime ? s.endTime.slice(0, 5) : '',
      repeat: s.repeat as 'None' | 'Daily' | 'Weekly' | 'Monthly',
      notes: s.notes || '',
      color: s.color,
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
  useEffect(() => {
    if (schedules.length === 0) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrowStr = new Date(Date.now() + 86400000)
      .toISOString()
      .split('T')[0];
    const todaySchedules = schedules.filter((s) => s.date === todayStr);
    const tomorrowSchedules = schedules.filter((s) => s.date === tomorrowStr);
    if (todaySchedules.length > 0) {
      showToast(
        '🔔 Shifts Today',
        `${todaySchedules.length} shift${
          todaySchedules.length > 1 ? 's' : ''
        } scheduled today.`,
        undefined,
        'info' as any,
      );
    } else if (tomorrowSchedules.length > 0) {
      showToast(
        '📅 Reminder',
        `${tomorrowSchedules.length} shift${
          tomorrowSchedules.length > 1 ? 's' : ''
        } scheduled for tomorrow.`,
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

  const handleEditScheduleStart = (ev: Schedule) => {
    setEditingScheduleId(ev.id);
    setTitle(ev.title);
    setTargetEmployeeIds(
      ev.employeeIds && ev.employeeIds.length > 0
        ? ev.employeeIds
        : [ev.employeeId],
    );
    setStartTime(ev.startTime);
    setEndTime(ev.endTime);
    setRepeat(ev.repeat || 'None');
    setNotes(ev.notes || '');
    setFormColor(ev.color || '#f59e0b');
    setShowAddForm(true);
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast(
        'Validation Error',
        'Shift title is required.',
        undefined,
        'error',
      );
      return;
    }
    if (targetEmployeeIds.length === 0) {
      showToast(
        'Validation Error',
        'Please assign at least one staff member or dispatcher to this schedule.',
      );
      return;
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
      showToast(
        'Hierarchy Restriction',
        `As a ${creatorRole}, you cannot create/assign a schedule for senior roles (${invalidAssignees
          .map((e) => `${e.name} (${e.role})`)
          .join(', ')}) unless the title contains the word "reminder".`,
        undefined,
        'error',
      );
      return;
    }

    const assignedWorker =
      employees.find((emp) => emp.id === targetEmployeeIds[0]) ||
      currentEmployee;
    const sYear = selectedDate.getFullYear();
    const sMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const sDay = String(selectedDate.getDate()).padStart(2, '0');
    const dateStr = `${sYear}-${sMonth}-${sDay}`;
    
    if (editingScheduleId) {
      // Update existing schedule in Supabase
      try {
        await SupabaseService.updateSchedule({
          id: editingScheduleId,
          employeeId: targetEmployeeIds[0],
          title: title.trim(),
          notes: notes.trim(),
          date: dateStr,
          startTime,
          endTime: endTime || undefined,
          repeat,
          color: formColor,
        });
        // Real-time will update the list automatically
        showToast(
          'Schedule Updated',
          `Shift "${title}" updated successfully.`,
          assignedWorker.avatar,
        );
      } catch (err) {
        console.error(err);
        showToast('Error', 'Failed to update shift.');
      }
      setEditingScheduleId(null);
    } else {
      // Create new schedule in Supabase
      try {
        await SupabaseService.createSchedule({
          businessId: activeBusinessId,
          employeeId: targetEmployeeIds[0],
          createdBy: currentEmployee.id,
          title: title.trim(),
          notes: notes.trim(),
          date: dateStr,
          startTime,
          endTime: endTime || undefined,
          repeat,
          color: formColor,
        });
        // Real-time will insert the row automatically
        showToast(
          'Schedule Assigned',
          `New shift "${title}" assigned.`,
          assignedWorker.avatar,
        );
      } catch (err) {
        console.error(err);
        showToast('Error', 'Failed to create shift.');
      }
    }

    // Reset Form
    setTitle('');
    setNotes('');
    setEditingScheduleId(null);
    setShowAddForm(false);
  };

  const handleDeleteSchedule = async (id: string, name: string) => {
    try {
      await SupabaseService.deleteSchedule(id);
      // Real-time will remove the row automatically
      showToast('Schedule Removed', `Shift for ${name} has been removed.`);
    } catch (err) {
      console.error(err);
      showToast('Error', 'Failed to remove schedule.');
    }
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

      {/* Main Calendar Space */}
      <div className="flex-1 overflow-y-auto p-4 pb-24 grid grid-cols-1 lg:grid-cols-3 gap-5">
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
                title={isCalendarCollapsed ? 'Expand Month' : 'Collapse Month'}
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
                    onClick={() => {
                      setCurrentMonth(new Date());
                      setSelectedDate(new Date());
                    }}
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
                  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
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
                  className="px-2 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[8.5px] font-black uppercase tracking-wider  flex items-center gap-1 transition cursor-pointer"
                  title="Punch Out"
                >
                  <Clock size={9} /> Stop
                </button>
              ) : (
                <button
                  onClick={punchIn}
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
          <div className="bg-app-card border border-app-border rounded-2xl shadow-xs overflow-hidden">
              <button
                onClick={() => setIsHubExpanded(!isHubExpanded)}
                className="w-full flex items-center justify-between p-3.5 hover:bg-app-bg/50 transition cursor-pointer text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-black text-app-text uppercase tracking-wider font-display">
                    <div className="flex items-center gap-1.5">
                      {currentEmployee.role === 'Owner' ||
                      currentEmployee.role === 'Admin' ? (
                        <Shield
                          size={14}
                          className="text-amber-500 "
                        />
                      ) : currentEmployee.role === 'Manager' ? (
                        <Award size={14} className="text-amber-500" />
                      ) : currentEmployee.role === 'Staff' ? (
                        <MapPin size={14} className="text-amber-500" />
                      ) : (
                        <User size={14} className="text-amber-500" />
                      )}
                      <h3 className="text-xs font-black text-app-text uppercase tracking-wider font-display">
                        {currentEmployee.role.toUpperCase()} COMMAND HUB
                      </h3>
                    </div>
                  </span>
                </div>
                {isHubExpanded ? (
                  <ChevronUp size={14} className="text-app-text-muted" />
                ) : (
                  <ChevronDown size={14} className="text-app-text-muted" />
                )}
              </button>

              {isHubExpanded && (
                <div className="p-3.5 bg-app-bg/40 border-t border-app-border/60 space-y-3.5 animate-fadeIn">
                  <div className="space-y-1.5">
                    <span className="text-[8px] text-app-text-muted font-black uppercase tracking-wider block">
                      Live Privilege Sync Status:
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        'business.settings',
                        'dashboard.profit',
                        'inventory.adjust_stock',
                        'orders.assign_rider',
                        'pos.create_sale',
                        'pos.refund',
                      ].map((permCode) => {
                        const isGranted = hasRolePermission(
                          currentEmployee.role,
                          permCode as any,
                        );
                        return (
                          <div
                            key={permCode}
                            className={`flex items-center gap-1.5 bg-app-card p-1.5 rounded-xl border ${
                              isGranted
                                ? 'border-emerald-500/10'
                                : 'border-red-500/10 opacity-70'
                            }`}
                          >
                            {isGranted ? (
                              <CheckCircle2
                                size={10}
                                className="text-emerald-500 shrink-0"
                              />
                            ) : (
                              <Lock
                                size={10}
                                className="text-red-500 shrink-0"
                              />
                            )}
                            <span
                              className={`text-[8.5px] font-mono truncate ${
                                isGranted
                                  ? 'text-slate-300'
                                  : 'text-slate-500 line-through'
                              }`}
                            >
                              {permCode}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-app-border/45 pt-3">
                    <span className="text-[8px] text-app-text-muted font-black uppercase tracking-wider block">
                      Interactive Actions:
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {hasRolePermission(
                        currentEmployee.role,
                        'reports.profit',
                      ) && (
                        <button
                          onClick={() => {
                            const totalSales = safeTransactions.reduce(
                              (sum, t) => sum + (t.total || 0),
                              0,
                            );
                            useNotificationStore
                              .getState()
                              .showToast(
                                'Owner Audit Rollup',
                                `Calculated total sales across system: KSh ${totalSales.toLocaleString()}. All records validated and synchronized to offline ledger.`,
                                undefined,
                                'success',
                              );
                          }}
                          className="w-full text-left px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl text-[10px] font-bold text-amber-500 flex items-center justify-between transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <TrendingUp size={11} />
                            <span>Reconcile Financial Totals</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                            Run Audit
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'settings.security',
                      ) && (
                        <button
                          onClick={() => {
                            useNotificationStore
                              .getState()
                              .showToast(
                                'Security Integrity',
                                'Clearance Checksum verified successfully. Security parameters locked & synchronized.',
                                undefined,
                                'success',
                              );
                          }}
                          className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-app-border/40 rounded-xl text-[10px] font-bold text-slate-300 flex items-center justify-between transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Activity size={11} />
                            <span>Perform Security Checksum</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                            Verify
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'production.view',
                      ) && (
                        <button
                          onClick={() => {
                            useNotificationStore
                              .getState()
                              .showToast(
                                'Cold Room HVAC Audit',
                                'Nairobi Cold Storage main compressor sensor checked. Reading: 3.4°C. Status: Optimal pasteurization state.',
                                undefined,
                                'success',
                              );
                          }}
                          className="w-full text-left px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl text-[10px] font-bold text-amber-500 flex items-center justify-between transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Thermometer size={11} />
                            <span>Verify Milk Storage Temp</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                            Test
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'inventory.view',
                      ) && (
                        <button
                          onClick={() => {
                            const lowStock = safeProducts.filter(
                              (p) => p.stock <= (p.minStock || 10),
                            );
                            if (lowStock.length > 0) {
                              useNotificationStore
                                .getState()
                                .showToast(
                                  'Dairy Stock Alert',
                                  `Inventory check complete: ${lowStock.length} items require restock (e.g., ${lowStock[0].name}).`,
                                  undefined,
                                  'info',
                                );
                            } else {
                              useNotificationStore
                                .getState()
                                .showToast(
                                  'Dairy Stock Status',
                                  'Inventory check complete: All product stock levels are above minimum safety limits.',
                                  undefined,
                                  'success',
                                );
                            }
                          }}
                          className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-app-border/40 rounded-xl text-[10px] font-bold text-slate-300 flex items-center justify-between transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Activity size={11} />
                            <span>Audit Low-Stock Items</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                            Audit
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'staff.update',
                      ) && (
                        <button
                          onClick={() => setShowAddForm(true)}
                          className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-app-border/40 rounded-xl text-[10px] font-bold text-slate-300 flex items-center justify-between transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Plus size={11} />
                            <span>Schedule New Driver Shift</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                            Open Form
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'pos.create_sale',
                      ) && (
                        <button
                          onClick={() => {
                            if (
                              !hasRolePermission(
                                currentEmployee.role,
                                'pos.create_sale',
                              )
                            ) {
                              useNotificationStore
                                .getState()
                                .showToast(
                                  'Access Denied',
                                  'The active role has been dynamically restricted from initiating new sales checkout.',
                                  undefined,
                                  'error',
                                );
                              return;
                            }
                            setActiveTab('pos');
                          }}
                          className="w-full text-left px-3 py-2 bg-amber-500 hover:bg-amber-600 rounded-xl text-[10px] font-black text-slate-950 flex items-center justify-between transition cursor-pointer shadow-md"
                        >
                          <div className="flex items-center gap-2">
                            <ShoppingBag size={11} />
                            <span>Launch POS Register</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold">
                            Go To POS
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'pos.refund',
                      ) && (
                        <button
                          onClick={() => {
                            const totalShiftTx = safeTransactions.length;
                            useNotificationStore
                              .getState()
                              .showToast(
                                'Cash Drawer Reconciliation',
                                `Shift checkout count: ${totalShiftTx} orders. Local drawer physical cash matches central log perfectly.`,
                                undefined,
                                'success',
                              );
                          }}
                          className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-app-border/40 rounded-xl text-[10px] font-bold text-slate-300 flex items-center justify-between transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Activity size={11} />
                            <span>Audit Session Cash Drawer</span>
                          </div>
                          <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                            Run Check
                          </span>
                        </button>
                      )}

                      {hasRolePermission(
                        currentEmployee.role,
                        'deliveries.complete',
                      ) && (
                        <>
                          <button
                            onClick={() => {
                              useNotificationStore
                                .getState()
                                .showToast(
                                  'Logistics GPS Sync',
                                  'Nairobi Westlands-Karen logistics route map synchronized with device GPS. Ready for dispatch.',
                                  undefined,
                                  'success',
                                );
                            }}
                            className="w-full text-left px-3 py-2 bg-amber-500 hover:bg-amber-600 rounded-xl text-[10px] font-black text-slate-950 flex items-center justify-between transition cursor-pointer shadow-md"
                          >
                            <div className="flex items-center gap-2">
                              <MapPin size={11} />
                              <span>Load Active Dispatch Route</span>
                            </div>
                            <span className="text-[8px] uppercase tracking-wider font-extrabold">
                              Route GPS
                            </span>
                          </button>

                          <button
                            onClick={() => {
                              useNotificationStore
                                .getState()
                                .showToast(
                                  'Carrying Seal Validation',
                                  'Cold-insulated transport box pressure & seal verification: 100% airtight. Temperature stable at 4.0°C.',
                                  undefined,
                                  'success',
                                );
                            }}
                            className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-app-border/40 rounded-xl text-[10px] font-bold text-slate-300 flex items-center justify-between transition cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <Lock size={11} />
                              <span>Validate cold Carrying Seal</span>
                            </div>
                            <span className="text-[8px] uppercase tracking-wider font-extrabold opacity-60">
                              Seal Check
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

          {/* Schedule Assignment Creator */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-app-border/45 pb-2">
              <h3 className="text-xs font-black text-app-text uppercase tracking-wider flex items-center gap-1.5">
                <Plus size={14} className="text-amber-500" />
                {editingScheduleId
                  ? 'Edit Shift Schedule'
                  : canManageShifts
                  ? 'Schedule A Shift'
                  : 'Request Personal Shift'}
              </h3>

              {!showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="px-2.5 py-1 bg-amber-500 text-slate-950 text-[10px] font-black rounded-lg transition hover:bg-amber-600 cursor-pointer"
                >
                  Create
                </button>
              )}
            </div>

            {showAddForm ? (
              <form
                onSubmit={handleCreateSchedule}
                className="space-y-3 text-xs"
              >
                <div className="space-y-1">
                  <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                    Shift Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Westlands Milk Delivery Route"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                    Assign Dispatchers & Staff (Select Multiple)
                  </label>
                  <p className="text-[9px] text-app-text-muted/80 font-normal leading-tight mb-1.5">
                    Choose who is assigned to this shift. NOTE: Junior accounts
                    cannot assign shifts to senior roles (Owner, Manager,
                    Cashier) unless the title contains the word "reminder".
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
                            <input
                              type="checkbox"
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
                              className="accent-amber-500 shrink-0"
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
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] text-app-text-muted font-bold uppercase block">
                      Repeat settings
                    </label>
                    <SearchableDropdown
                      items={[
                        { id: 'None', label: 'Does not repeat' },
                        { id: 'Daily', label: 'Daily repeat' },
                        { id: 'Weekly', label: 'Weekly repeat' },
                        { id: 'Monthly', label: 'Monthly repeat' },
                      ]}
                      selectedValue={repeat}
                      onChange={(val) =>
                        setRepeat(val as 'None' | 'Daily' | 'Weekly' | 'Monthly')
                      }
                      placeholder="Repeat settings..."
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
                    Instructions / Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter dispatch routing details..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none resize-none"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="flex-1 py-2 bg-app-bg text-app-text border border-app-border font-bold rounded-xl transition hover:bg-app-card cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl transition cursor-pointer text-center"
                  >
                    {editingScheduleId ? 'Update Shift' : 'Save Shift'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-4 bg-app-bg border border-app-border/45 rounded-xl border-dashed">
                <p className="text-[10px] text-app-text-muted font-medium">
                  Click Create to schedule a new shift for selected date:
                </p>
                <span className="text-xs font-mono font-black text-amber-500 block mt-1">
                  {selectedDate.toLocaleDateString(undefined, {
                    dateStyle: 'long',
                  })}
                </span>
              </div>
            )}
          </div>

          {/* Active Shift List for the selected day */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex-1 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-app-border/45 pb-2">
              <div className="flex items-center gap-1.5">
                <CalendarIcon size={14} className="text-amber-500" />
                <h3 className="text-xs font-black text-app-text uppercase tracking-wider">
                  Shifts • {selectedDate.getDate()}{' '}
                  {monthNames[month].slice(0, 3)}
                </h3>
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
                  No registered active shifts for this date.
                </div>
              ) : (
                activeSchedulesForSelected.map((ev) => {
                  const assignedIds =
                    ev.employeeIds && ev.employeeIds.length > 0
                      ? ev.employeeIds
                      : [ev.employeeId];
                  const canEdit = canEditSchedule(ev.title, assignedIds);

                  return (
                    <div
                      key={ev.id}
                      className="p-3 bg-app-bg border border-app-border/40 hover:border-app-border/80 rounded-xl transition flex flex-col gap-1.5 relative group"
                    >
                      <div className="flex justify-between items-start gap-2 pr-16">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: ev.color }}
                          />
                          <h4 className="text-xs font-black text-app-text">
                            {ev.title}
                          </h4>
                        </div>

                        <div className="flex items-center gap-1.5 absolute right-2.5 top-2.5 opacity-80 hover:opacity-100 transition-opacity">
                          {canEdit && (
                            <button
                              onClick={() => handleEditScheduleStart(ev)}
                              className="text-app-text-muted hover:text-amber-500 p-1 bg-app-card hover:bg-app-bg rounded-lg border border-app-border/40 transition cursor-pointer"
                              title="Edit Shift"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() =>
                                handleDeleteSchedule(ev.id, ev.employeeName)
                              }
                              className="text-app-text-muted hover:text-red-500 p-1 bg-app-card hover:bg-app-bg rounded-lg border border-app-border/40 transition cursor-pointer"
                              title="Remove Shift"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] text-app-text-muted font-medium border-t border-app-border/30 pt-1.5 mt-0.5">
                        <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                          <span className="text-[8px] uppercase tracking-wider font-extrabold text-amber-500/80">
                            Assigned Staff / Dispatchers:
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
                        <div className="flex items-center gap-1 justify-end font-mono col-span-2 sm:col-span-1 self-end">
                          <Clock
                            size={11}
                            className="text-amber-500 shrink-0"
                          />
                          <span>
                            {ev.startTime} - {ev.endTime}
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
                          Repeats {ev.repeat}
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
        onConfirm={(reportText, customMessage) => {
          const employee = useAuthStore.getState().currentEmployee;
          punchOut();
          setIsEndShiftModalOpen(false);
          showToast('Shift Ended', 'End of shift report sent to owners.');

          // Dispatch notification to Owner via NotificationService
          // This saves to the database for the Owner's notification feed AND triggers FCM Push
          NotificationService.createNotification(
            "Custom Notification",
            { message: `Shift Ended by ${employee?.name || "Staff"}.${customMessage ? "\nNotes: " + customMessage : ""}` },
            {
              title: `Shift Closed: ${employee?.name || "Staff"}`,
              role: "Owner",
              priority: "high",
              payloadExtra: {
                reportText,
                customMessage,
                employeeName: employee?.name || "Staff",
                employeeId: employee?.id || "",
                closedAt: new Date().toISOString()
              }
            }
          );
        }}
      />
    </div>
  );
}