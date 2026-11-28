// The branch list from the top bar or side menu: switch branch, and for those allowed,
// add, edit or delete a branch.
import { useState } from 'react';
import { useOverlay } from '../hooks/useOverlay';
import { useAppStore } from '../stores/appStore';
import SearchableDropdown from '../components/SearchableDropdown';
import UnifiedUploader from '../components/shared/UnifiedUploader';
import { hasRolePermission } from '../utils/permissions';
import { confirmDelete } from '../components/DeleteImpact';
import { Edit, Check, Trash2, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SwipeRow } from '../components/shared/SwipeRow';
import { markBranchChosen } from '../utils/branchChoice';
import { WorkspaceLogo } from './WorkspaceLogo';


export function BranchesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    activeBusinessId,
    setActiveBusinessId,
    businesses,
    addBusiness,
    updateBusiness,
    deleteBusiness,
    currentEmployee,
    currentUser,
    showToast,
  } = useAppStore();
  const showBusinessDropdown = open;
  useOverlay(open, onClose, 'dialog');
  const setShowBusinessDropdown = (next: boolean) => {
    if (!next) onClose();
  };

  // New branch form
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [newBizName, setNewBizName] = useState('');
  const [newBizDesc, setNewBizDesc] = useState('');
  const [newBizAddr, setNewBizAddr] = useState('');
  const [newBizLogo, setNewBizLogo] = useState('');
  const [newBizCover, setNewBizCover] = useState('');
  const [newBizPhone, setNewBizPhone] = useState('');
  const [newBizEmail, setNewBizEmail] = useState('');
  const [newBizCurrency, setNewBizCurrency] = useState('Ksh');
  const [newBizTimezone, setNewBizTimezone] = useState('Africa/Nairobi');
  const [newBizType, setNewBizType] = useState('');
  const [newBizPaymentMethods, setNewBizPaymentMethods] = useState<string[]>(['Cash', 'M-Pesa']);
  // Edit branch form
  const [editingBizId, setEditingBizId] = useState<string | null>(null);
  const [editBizName, setEditBizName] = useState('');
  const [editBizDesc, setEditBizDesc] = useState('');
  const [editBizAddr, setEditBizAddr] = useState('');
  const [editBizLogo, setEditBizLogo] = useState('');
  return (
    <>
      {/* Multi-Business Management & Switcher Modal Overlay */}
      <AnimatePresence>
        {showBusinessDropdown && (
          <>
            {/* Darkened backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowBusinessDropdown(false);
                setIsCreatingBusiness(false);
                setEditingBizId(null);
              }}
              className="fixed inset-0 bg-black z-[990]"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-x-4 bottom-4 md:bottom-auto md:top-24 md:left-1/2 md:-translate-x-1/2 md:max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-5 z-[995] overflow-hidden flex flex-col font-sans"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-3.5 shrink-0">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Choose a branch
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                    Switch or configure your branches (Max 5)
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowBusinessDropdown(false);
                    setIsCreatingBusiness(false);
                    setEditingBizId(null);
                  }}
                  className="w-6 h-6 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-400 dark:text-slate-500 text-xs font-bold transition"
                >
                  ✕
                </button>
              </div>

              {/* List of Branches */}
              {!isCreatingBusiness && !editingBizId ? (
                <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
                  {businesses
                    .filter((biz) => {
                      if (!currentEmployee) return false;
                      if (
                        hasRolePermission(
                          currentEmployee.role,
                          'settings.view',
                        )
                      ) {
                        return true;
                      }
                      const assigned = currentEmployee.assignedBranches || [];
                      if (assigned.length === 0) {
                        return biz.id === 'biz-1';
                      }
                      return assigned.includes(biz.id);
                    })
                    .map((biz) => {
                      const isActive = biz.id === activeBusinessId;
                      const canManageBranch = hasRolePermission(currentEmployee?.role ?? '', 'settings.view');
                      const editBranch = () => {
                        setEditingBizId(biz.id);
                        setEditBizName(biz.name);
                        setEditBizDesc(biz.description || '');
                        setEditBizAddr(biz.address || '');
                        setEditBizLogo(biz.logoUrl || '');
                      };
                      const removeBranch = async () => {
                        if (await confirmDelete({ kind: 'branch', id: biz.id, name: biz.name, verb: 'Close' })) {
                          await deleteBusiness(biz.id);
                        }
                      };
                      const canRemoveBranch = canManageBranch && businesses.length > 1;
                      return (
                        <SwipeRow
                          key={biz.id}
                          title={biz.name}
                          subtitle={biz.address || biz.description || undefined}
                          surfaceClassName="bg-slate-50 dark:bg-slate-950"
                          actions={[{ label: 'Close', icon: <Trash2 size={18} />, tone: 'red', hidden: !canRemoveBranch, onClick: removeBranch }]}
                          more={[
                            { label: isActive ? 'Current branch' : 'Switch to this branch', icon: <Check size={16} />, disabled: isActive, onClick: () => { setActiveBusinessId(biz.id); markBranchChosen(biz.id, currentUser?.id); setShowBusinessDropdown(false); } },
                            { label: 'Edit branch', icon: <Edit size={16} />, hidden: !canManageBranch, onClick: editBranch },
                            { label: 'Close branch', icon: <Trash2 size={16} />, tone: 'red', hidden: !canRemoveBranch, onClick: removeBranch },
                          ]}
                          className={`rounded-2xl border transition-all ${
                            isActive ? 'border-amber-500' : 'border-slate-200 dark:border-slate-800 hover:border-amber-500/25'
                          }`}
                          contentClassName={`p-3 flex items-center justify-between gap-3 ${
                            isActive ? 'bg-[linear-gradient(rgba(245,158,11,0.1),rgba(245,158,11,0.1))]' : ''
                          }`}
                        >
                          <div
                            onClick={() => {
                              setActiveBusinessId(biz.id);
                              markBranchChosen(biz.id, currentUser?.id);
                              setShowBusinessDropdown(false);
                            }}
                            className="flex-1 flex items-center gap-3 cursor-pointer min-w-0"
                          >
                            <WorkspaceLogo
                              logoUrl={biz.logoUrl}
                              name={biz.name}
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-50 truncate">
                                {biz.name}
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {biz.description || 'Branch'}
                              </p>
                              {biz.address && (
                                <span className="text-[11px] text-amber-500 font-semibold block mt-1">
                                  {biz.address}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quick Edit/Delete Actions for Owner */}
                          {hasRolePermission(
                            currentEmployee?.role ?? '',
                            'settings.view',
                          ) && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={editBranch}
                                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800/80 transition text-xs flex items-center justify-center"
                                title="Edit branch settings"
                              >
                                <Edit size={11} className="text-slate-500" />
                              </button>
                              {businesses.length > 1 && (
                                <button
                                  onClick={removeBranch}
                                  className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-lg border border-red-500/20 transition text-xs flex items-center justify-center"
                                  title="Close branch"
                                >
                                  <Trash2
                                    size={11}
                                    className="text-red-500"
                                  />
                                </button>
                              )}
                            </div>
                          )}
                        </SwipeRow>
                      );
                    })}

                  {businesses.length < 5 &&
                    hasRolePermission(
                      currentEmployee?.role ?? '',
                      'settings.view',
                    ) && (
                      <button
                        onClick={() => {
                          setIsCreatingBusiness(true);
                          setNewBizName('');
                          setNewBizDesc('');
                          setNewBizAddr('');
                        }}
                        className="mt-2 py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-amber-500/50 rounded-2xl text-[10px] font-semibold text-amber-500 hover:bg-amber-500/5 transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        ➕ Create Branch ({businesses.length}/5)
                      </button>
                    )}
                </div>
              ) : isCreatingBusiness ? (
                /* Create Business form */
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newBizName.trim()) {
                      showToast(
                        'Check the form',
                        'Branch/Business Name is required.',
                        undefined,
                        'error',
                      );
                      return;
                    }
                    if (
                      newBizEmail.trim() &&
                      !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
                        newBizEmail,
                      )
                    ) {
                      showToast(
                        'Check the form',
                        'Enter a valid email address.',
                        undefined,
                        'error',
                      );
                      return;
                    }
                    if (
                      newBizPhone.trim() &&
                      !/^\+[1-9]\d{1,14}$/.test(newBizPhone)
                    ) {
                      showToast(
                        'Check the form',
                        'Enter the phone number with the country code, e.g. +254712345678.',
                        undefined,
                        'error',
                      );
                      return;
                    }

                    const biz = await addBusiness(
                      newBizName,
                      newBizDesc,
                      newBizAddr,
                      newBizLogo,
                      newBizType.trim() || 'Retail',
                      'Kenya',
                      newBizCurrency,
                      newBizCover,
                      newBizEmail,
                      newBizPhone,
                      newBizTimezone,
                      newBizPaymentMethods,
                    );

                    if (biz) {
                      setIsCreatingBusiness(false);
                      setNewBizName('');
                      setNewBizDesc('');
                      setNewBizAddr('');
                      setNewBizLogo('');
                      setNewBizCover('');
                      setNewBizPhone('');
                      setNewBizEmail('');
                      setNewBizCurrency('Ksh');
                      setNewBizTimezone('Africa/Nairobi');
                      setNewBizType('');
                      setNewBizPaymentMethods(['Cash', 'M-Pesa']);
                      setShowBusinessDropdown(false);
                    }
                  }}
                  className="flex flex-col gap-3.5 text-xs font-semibold animate-fade-in"
                >
                  <div className="flex-1 overflow-y-auto max-h-[360px] pr-1.5 space-y-3">
                    {/* Name */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Branch / Business Name *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Syokimau branch"
                        value={newBizName}
                        onChange={(e) => setNewBizName(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold"
                        required
                      />
                    </div>

                    {/* Description */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Description
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Next to the bus stage"
                        value={newBizDesc}
                        onChange={(e) => setNewBizDesc(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Address */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Location Address
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Airport Road, Nairobi"
                        value={newBizAddr}
                        onChange={(e) => setNewBizAddr(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Row: Type & Currency */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          Business Type
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Shop, Butchery"
                          value={newBizType}
                          onChange={(e) => setNewBizType(e.target.value)}
                          maxLength={60}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          Currency
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Ksh"
                          value={newBizCurrency}
                          onChange={(e) => setNewBizCurrency(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold"
                        />
                      </div>
                    </div>

                    {/* Timezone */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Time Zone
                      </label>
                      <SearchableDropdown
                        items={[
                          {
                            id: 'Africa/Nairobi',
                            label: 'East Africa Time (EAT - Nairobi)',
                          },
                          {
                            id: 'UTC',
                            label: 'Coordinated Universal Time (UTC)',
                          },
                          { id: 'GMT', label: 'Greenwich Mean Time (GMT)' },
                          {
                            id: 'Africa/Lagos',
                            label: 'West Africa Time (WAT - Lagos)',
                          },
                          {
                            id: 'Africa/Johannesburg',
                            label: 'South Africa Time (SAST - Joburg)',
                          },
                        ]}
                        selectedValue={newBizTimezone}
                        onChange={(val) => setNewBizTimezone(val)}
                        placeholder="Select timezone..."
                      />
                    </div>

                    {/* Row: Contact Phone & Email */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          Contact Phone
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. +254712345678"
                          value={newBizPhone}
                          onChange={(e) => setNewBizPhone(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold font-mono"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          Contact Email
                        </label>
                        <input
                          type="email"
                          placeholder="e.g. info@biz.com"
                          value={newBizEmail}
                          onChange={(e) => setNewBizEmail(e.target.value)}
                          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-semibold"
                        />
                      </div>
                    </div>

                    {/* Default Payment Methods */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Default Payment Methods
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Cash', 'M-Pesa', 'Airtel Money', 'Card', 'Bank'].map((method) => {
                          const isChecked =
                            newBizPaymentMethods.includes(method);
                          return (
                            <button
                              key={method}
                              type="button"
                              onClick={() => {
                                if (isChecked) {
                                  setNewBizPaymentMethods(
                                    newBizPaymentMethods.filter(
                                      (m) => m !== method,
                                    ),
                                  );
                                } else {
                                  setNewBizPaymentMethods([
                                    ...newBizPaymentMethods,
                                    method,
                                  ]);
                                }
                              }}
                              className={`py-1.5 px-3 rounded-lg border text-[10px] font-bold transition flex items-center justify-between cursor-pointer ${
                                isChecked
                                  ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-850 text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              <span>{method}</span>
                              {isChecked && <Check size={12} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Logo Image Upload */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Branch Logo Picture
                      </label>
                      <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-2.5">
                        {newBizLogo ? (
                          <img
                            src={newBizLogo}
                            alt="Logo preview"
                            className="w-10 h-10 rounded-lg object-cover border border-amber-500/20"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                            <Camera size={14} className="text-slate-400" />
                          </div>
                        )}
                        <UnifiedUploader
                          onUploadSuccess={(url) => setNewBizLogo(url)}
                          allowedTypes={['image']}
                          cropAspect={1}
                          buttonText="Upload Logo"
                          bucketName="business-logos"
                          className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-[11px] rounded-lg transition select-none text-center w-full cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Cover Image Upload */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        Branch Cover Image
                      </label>
                      <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-2.5">
                        {newBizCover ? (
                          <img
                            src={newBizCover}
                            alt="Cover preview"
                            className="w-16 h-10 rounded-lg object-cover border border-amber-500/20"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-16 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                            <Camera size={14} className="text-slate-400" />
                          </div>
                        )}
                        <UnifiedUploader
                          onUploadSuccess={(url) => setNewBizCover(url)}
                          allowedTypes={['image']}
                          cropAspect={1.6}
                          buttonText="Upload Cover"
                          bucketName="business-logos"
                          className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-[11px] rounded-lg transition select-none text-center w-full cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingBusiness(false);
                        setNewBizName('');
                        setNewBizDesc('');
                        setNewBizAddr('');
                        setNewBizLogo('');
                        setNewBizCover('');
                        setNewBizPhone('');
                        setNewBizEmail('');
                        setNewBizCurrency('Ksh');
                        setNewBizTimezone('Africa/Nairobi');
                        setNewBizType('');
                        setNewBizPaymentMethods(['Cash', 'M-Pesa']);
                      }}
                      className="flex-1 py-2 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-[11px] text-slate-400 dark:text-slate-500 cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl text-[11px] cursor-pointer"
                    >
                      Add branch
                    </button>
                  </div>
                </form>
              ) : (
                /* Edit Business form */
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!editBizName.trim()) {
                      showToast(
                        'Check the form',
                        'Branch/Business Name is required.',
                        undefined,
                        'error',
                      );
                      return;
                    }
                    if (editingBizId) {
                      updateBusiness(
                        editingBizId,
                        editBizName,
                        editBizDesc,
                        editBizAddr,
                        editBizLogo,
                      );
                      setEditingBizId(null);
                      setEditBizLogo('');
                      showToast(
                        'Branch updated',
                        `Branch details saved.`,
                      );
                    }
                  }}
                  className="flex flex-col gap-3.5 text-xs font-semibold animate-fade-in"
                >
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                      Branch / Business Name *
                    </label>
                    <input
                      type="text"
                      value={editBizName}
                      onChange={(e) => setEditBizName(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500 font-bold"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                      Description
                    </label>
                    <input
                      type="text"
                      value={editBizDesc}
                      onChange={(e) => setEditBizDesc(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                      Location Address
                    </label>
                    <input
                      type="text"
                      value={editBizAddr}
                      onChange={(e) => setEditBizAddr(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  {/* Logo Image Upload / Edit */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                      Update Logo Picture
                    </label>
                    <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-2.5">
                      {editBizLogo ? (
                        <img
                          src={editBizLogo}
                          alt="Logo preview"
                          className="w-10 h-10 rounded-lg object-cover border border-amber-500/20"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center shrink-0">
                          <Camera size={14} className="text-slate-400" />
                        </div>
                      )}
                      <UnifiedUploader
                        onUploadSuccess={(url) => setEditBizLogo(url)}
                        allowedTypes={['image']}
                        cropAspect={1}
                        buttonText="Change Logo"
                        bucketName="business-logos"
                        className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-[11px] rounded-lg transition select-none text-center w-full cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBizId(null);
                        setEditBizLogo('');
                      }}
                      className="flex-1 py-2 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-[11px] text-slate-400 dark:text-slate-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl text-[11px]"
                    >
                      Save Details
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
