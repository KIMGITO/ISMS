// First business set-up, for the person allowed to create one.
import { useAppStore } from '../../stores/appStore';
import SearchableDropdown from '../../components/SearchableDropdown';
import { Building } from 'lucide-react';
import type { AuthFlow } from './useAuthFlow';

/** Set up the business and its first branch (only while the server allows it). */
export function CreateBusinessScreen({
  auth,
}: {
  auth: AuthFlow;
}) {
  const { createBusinessWithOwner } = useAppStore();
  const {
    businessType,
    setBusinessType,
    finalBusinessType,
    setAuthViewTab,
    adminPlanCode,
    setAdminPlanCode,
    bizNameField,
    setBizNameField,
    bizCountryField,
    setBizCountryField,
    bizCurrencyField,
    setBizCurrencyField,
    authLoading,
    setAuthLoading,
    setAuthError,
    setAuthSuccess,
  } = auth;
  return (
    <div className="space-y-5 text-xs animate-fade-in">
      <div className="text-center space-y-1">
        <h3 className="text-xs font-semibold text-amber-600 flex items-center justify-center gap-1.5">
          <Building size={16} /> Set up your business
        </h3>
        <p className="text-[10.5px] text-slate-500">
          Tell us about your business and first branch.
        </p>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!bizNameField.trim()) {
            setAuthError('Business name is required.');
            return;
          }
          if (!finalBusinessType) {
            setAuthError('Type what kind of business it is.');
            return;
          }
          setAuthLoading(true);
          setAuthError('');
          setAuthSuccess('');
          const res = await createBusinessWithOwner(
            bizNameField,
            finalBusinessType,
            bizCountryField,
            bizCurrencyField,
            undefined,
            undefined,
            undefined,
            adminPlanCode,
          );
          setAuthLoading(false);
          if (res.success) {
            setBizNameField('');
            setAdminPlanCode(undefined);
          } else {
            setAuthError(
              res.error || 'Failed to create business.',
            );
          }
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 font-bold block">
            Business / Outlet Name *
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="e.g. My Shop, Nairobi"
              value={bizNameField}
              onChange={(e) =>
                setBizNameField(e.target.value)
              }
              className="w-full bg-slate-50 text-slate-900 pl-8 pr-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none"
            />
            <Building
              size={13}
              className="absolute left-3 top-3.5 text-slate-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-bold block">
              Business Type *
            </label>

            <input
              type="text"
              placeholder="e.g. Shop, Butchery, Salon"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              maxLength={60}
              className="w-full bg-slate-50 text-slate-900 px-3 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none text-xs placeholder:text-slate-400"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-500 font-bold block">
              Country *
            </label>
            <div className="relative">
              <SearchableDropdown
                items={[
                  { id: 'Kenya', label: 'Kenya' },
                  { id: 'Uganda', label: 'Uganda' },
                  { id: 'Tanzania', label: 'Tanzania' },
                  { id: 'Rwanda', label: 'Rwanda' },
                  { id: 'Somalia', label: 'Somalia' },
                ]}
                selectedValue={bizCountryField}
                onChange={(val) => setBizCountryField(val)}
                placeholder="Select country..."
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 font-bold block">
            Base Operating Currency *
          </label>
          <div className="relative">
            <SearchableDropdown
              items={[
                { id: 'Ksh', label: 'Ksh (Kenyan Shilling)' },
                {
                  id: 'USh',
                  label: 'USh (Ugandan Shilling)',
                },
                {
                  id: 'TSh',
                  label: 'TSh (Tanzanian Shilling)',
                },
                { id: 'RWF', label: 'RWF (Rwandan Franc)' },
                { id: 'USD', label: 'USD (US Dollar)' },
              ]}
              selectedValue={bizCurrencyField}
              onChange={(val) => setBizCurrencyField(val)}
              placeholder="Select currency..."
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={authLoading}
          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-semibold rounded-xl transition font-sans"
        >
          {authLoading
            ? 'Setting up...'
            : 'Create my business'}
        </button>
        <button
          type="button"
          onClick={() => {
            setAuthError('');
            setAdminPlanCode(undefined);
            setAuthViewTab('start');
          }}
          className="w-full text-[11px] text-slate-500 hover:text-slate-800 font-semibold"
        >
          Back
        </button>
      </form>
    </div>
  );
}
