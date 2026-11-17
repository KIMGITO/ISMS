import { FormEvent, useEffect, useState } from 'react';
import { CalendarClock, Gift, LogOut, MessageSquare, Package, UserRound } from 'lucide-react';
import { fetchMessages, friendlyError, locationOf, supabase, updateProfile } from '../api';
import { CUSTOMER_FIELDS as F, displayPhone, isValidPhone, MESSAGES, NAME_MAX } from '../customerProfile';
import DeliveryLocationFields from './DeliveryLocationFields';
import { useAuth, useCart } from '../store';
import { navigate } from '../router';
import { RETURN_KEY } from './CartPage';
import { ErrorText, fieldClass, Loading, pageClass, primaryButton, secondaryButton } from '../ui';
import { AuthForms, FinishAccountForm } from './AuthForms';
import OrdersTab from './OrdersTab';
import SchedulesTab from './SchedulesTab';
import MessagesTab from './MessagesTab';
import RewardsTab from './RewardsTab';
import ContactPreferences from './ContactPreferences';

const TABS = [
  { id: 'orders', label: 'Orders', icon: Package },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'rewards', label: 'Rewards', icon: Gift },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

function ProfileTab() {
  const account = useAuth((s) => s.account)!;
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(displayPhone(account.phone));
  const [location, setLocation] = useState(locationOf(account));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    if (!name.trim()) return setError(MESSAGES.name);
    if (!isValidPhone(phone)) return setError(MESSAGES.phone);
    setBusy(true);
    try {
      await updateProfile(name, phone, location);
      await useAuth.getState().refreshAccount();
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Your details</h2>
          <label className="block font-medium">
            {F.name.label}
            <input required maxLength={NAME_MAX} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </label>
          <label className="block font-medium">
            {F.phone.label}
            <input required type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
          </label>
          {account.email && <p className="text-muted">{F.email.label}: {account.email}</p>}
        </section>
        <section className="space-y-4 border-t border-line pt-6">
          <h2 className="text-xl font-semibold">Delivery location</h2>
          <DeliveryLocationFields value={location} onChange={setLocation} />
        </section>
        <ErrorText>{error}</ErrorText>
        {saved && <p role="status" className="font-medium text-emerald-700">Saved.</p>}
        <button type="submit" disabled={busy} className={`${primaryButton} w-full sm:w-auto`}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
      <ContactPreferences />
      <button onClick={() => supabase.auth.signOut()} className={`${secondaryButton} mt-8 w-full sm:w-auto`}>
        <LogOut size={18} aria-hidden /> Sign out
      </button>
    </div>
  );
}

export default function AccountPage({ route }: { route: string[] }) {
  const ready = useAuth((s) => s.ready);
  const session = useAuth((s) => s.session);
  const account = useAuth((s) => s.account);
  const [unread, setUnread] = useState(0);
  const tab = TABS.some((t) => t.id === route[0]) ? route[0] : 'orders';

  // A shopper who signed in from checkout (Google returns here) goes back to it.
  useEffect(() => {
    if (!account) return;
    try {
      const back = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      if (back && useCart.getState().lines.length > 0) navigate(back, { replace: true });
    } catch { /* stay on the account page */ }
  }, [account]);

  useEffect(() => {
    if (!account) return;
    fetchMessages()
      .then((messages) => setUnread(messages.filter((m) => m.sender !== 'customer' && !m.read_at).length))
      .catch(() => setUnread(0));
  }, [account, tab]);

  if (!ready) return <Loading />;
  if (!session) return <AuthForms />;
  if (!account) return <FinishAccountForm />;

  return (
    <div className={pageClass}>
      <h1 className="text-4xl font-semibold">Hello, {account.name.split(' ')[0]}</h1>
      <nav aria-label="Account" className="-mx-4 mt-6 flex gap-2 overflow-x-auto border-b border-line px-4 pb-3 sm:mx-0 sm:px-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`/account/${id}`}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3.5 font-medium ${
              tab === id ? 'bg-amber-100 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon size={18} aria-hidden /> {label}
            {id === 'messages' && unread > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-brand-deep text-xs font-semibold text-white">{unread}</span>
            )}
          </a>
        ))}
      </nav>
      <div className="mt-6">
        {tab === 'orders' && <OrdersTab orderId={route[1]} />}
        {tab === 'schedules' && <SchedulesTab />}
        {tab === 'messages' && <MessagesTab onRead={() => setUnread(0)} />}
        {tab === 'rewards' && <RewardsTab />}
        {tab === 'profile' && <ProfileTab />}
      </div>
    </div>
  );
}
