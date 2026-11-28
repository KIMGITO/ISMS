import { toUserMessage } from "../utils/userError";
import React, { useEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/appStore";
import { UserPlus, Trash2, CheckCircle2, AlertCircle, Shield, Mail, Phone, User, Edit, X, Camera, Search, Send, Copy, Clock, RefreshCw, Ban } from "lucide-react";
import { SwipeRow } from "../components/shared/SwipeRow";
import SearchableDropdown from "../components/SearchableDropdown";
import { normalizePhone, validatePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { titleCase, searchMatch, formatName } from "../utils/stringUtils";
import UnifiedUploader from "../components/shared/UnifiedUploader";
import { EmployeeRole } from "../types";
import { hasRolePermission, getDynamicRoles } from "../utils/permissions";
import { appDialog } from '../components/AppDialog';
import { confirmDelete } from '../components/DeleteImpact';
import { useUiStore } from "../stores/uiStore";
import { SuppliersTeamCard } from "../components/buying/SuppliersTeamCard";
import { listSuppliers, saveSupplier, type Supplier } from "../services/operations";
import { inviteSupplierUser } from "../services/supplierPortal";
import JoinCodePanel from "../components/staff/JoinCodePanel";

const PRESET_AVATARS = [
  { id: "preset-1", name: "Sarah", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150" },
  { id: "preset-2", name: "Michael", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150" },
  { id: "preset-3", name: "Emily", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150" },
  { id: "preset-4", name: "David", url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150" },
  { id: "preset-5", name: "Grace", url: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150" },
  { id: "preset-6", name: "Alex", url: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=150" }
];

export default function WorkersView() {
  const { 
    employees, 
    createWorker, 
    deleteWorker, 
    updateProfile, 
    businesses, 
    currentEmployee,
    invitations,
    inviteUser,
    revokeInvitation,
    currentBusinessId,
    showToast,
  } = useAppStore();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedCountryCode, setSelectedCountryCode] = useState("+254");
  const [role, setRole] = useState<EmployeeRole>("Cashier");
  const [selectedAvatar, setSelectedAvatar] = useState(PRESET_AVATARS[0].url);
  
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");


  // Edit employee state (for role updates)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const formBoxRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingWorker, setIsDeletingWorker] = useState(false);
  const [isRevokingInvite, setIsRevokingInvite] = useState(false);

  const canInviteStaff = currentEmployee ? hasRolePermission(currentEmployee.role, "staff.invite") : false;
  const canUpdateStaff = currentEmployee ? hasRolePermission(currentEmployee.role, "staff.update") : false;
  // Suppliers are added and invited here like everyone else, with the Supplier role.
  const canAddSuppliers = currentEmployee ? hasRolePermission(currentEmployee.role, "suppliers.create") : false;
  const canInviteSuppliers = currentEmployee ? hasRolePermission(currentEmployee.role, "suppliers.portal") : false;
  const handlesSuppliers = canAddSuppliers || canInviteSuppliers;
  const canRemoveStaff = currentEmployee ? hasRolePermission(currentEmployee.role, "staff.remove") : false;
  const canDeleteInvite = currentEmployee ? hasRolePermission(currentEmployee.role, "invitations.delete") : false;
  // The roles this app has: built-in ones plus custom roles made on the Roles page.
  // Only Owners and Admins can make someone an Owner or Admin.
  const callerIsTop = ['Owner', 'Admin', 'Administrator'].includes(currentEmployee?.role || '');
  const roleOptions = Object.values(getDynamicRoles())
    // Supplier: someone at a company you buy from. Not for changing a staff member's role.
    .filter((r) => (r.name === 'Supplier' ? handlesSuppliers && !editingEmployeeId : canInviteStaff || !!editingEmployeeId))
    .filter((r) => callerIsTop || !['Owner', 'Admin', 'Administrator'].includes(r.name))
    .map((r) => ({ id: r.name, label: r.name === 'Supplier' ? 'Supplier' : r.name }));
  const isSupplier = role === ('Supplier' as EmployeeRole);

  // ----- Supplier role: which supplier they work for
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<string>('new');
  const [supplierCompany, setSupplierCompany] = useState('');
  const [supplierSupplies, setSupplierSupplies] = useState('');
  const [suppliersRefresh, setSuppliersRefresh] = useState(0);
  useEffect(() => {
    if (!handlesSuppliers || !currentBusinessId) return;
    listSuppliers(currentBusinessId).then(setSuppliers).catch(() => setSuppliers([]));
  }, [handlesSuppliers, currentBusinessId, suppliersRefresh]);

  /** Fills the form to invite someone at this supplier (from the Suppliers list or Buying). */
  const startSupplierInvite = (s?: Supplier) => {
    setEditingEmployeeId(null);
    setRole('Supplier' as EmployeeRole);
    setSupplierId(s?.id || 'new');
    setName(s?.name || '');
    setEmail(s?.email || '');
    const matched = s?.phone ? SUPPORTED_COUNTRIES.find((c) => s.phone.startsWith(c.code)) : undefined;
    setSelectedCountryCode(matched?.code || '+254');
    setPhone(s?.phone ? (matched ? s.phone.slice(matched.code.length) : s.phone) : '');
    setSuccessMsg('');
    setErrorMsg('');
    requestAnimationFrame(() => {
      formBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nameInputRef.current?.focus({ preventScroll: true });
    });
  };

  // Someone who can add suppliers but not staff only has the Supplier role to choose.
  useEffect(() => {
    if (!canInviteStaff && handlesSuppliers && !editingEmployeeId) setRole('Supplier' as EmployeeRole);
  }, [canInviteStaff, handlesSuppliers, editingEmployeeId]);

  // Buying → Suppliers → "Invite a supplier" opens this screen with the form ready.
  const screenSection = useUiStore((st) => st.screenSection);
  useEffect(() => {
    if (!screenSection?.startsWith('invite-supplier')) return;
    useUiStore.getState().setScreenSection(null);
    if (!handlesSuppliers) return;
    const id = screenSection.split(':')[1];
    const known = id ? suppliers.find((x) => x.id === id) : undefined;
    if (id && !known && suppliers.length === 0 && currentBusinessId) {
      // The list may not be loaded yet.
      listSuppliers(currentBusinessId).then((list) => { setSuppliers(list); startSupplierInvite(list.find((x) => x.id === id)); }).catch(() => startSupplierInvite());
    } else startSupplierInvite(known);
  }, [screenSection]);
  const selectedRoleInfo = getDynamicRoles()[role];

  /** Shows the result next to the button and as a toast, so it's seen wherever you are. */
  const notify = (kind: 'success' | 'error', text: string) => {
    if (kind === 'success') setSuccessMsg(text);
    else setErrorMsg(text);
    showToast(kind === 'success' ? text : "Couldn't save", kind === 'success' ? '' : text, undefined, kind);
  };

  const activeBusinessName =
    businesses.find((b) => b.id === currentBusinessId)?.name || "Your business";

  const removeWorker = async (emp: any) => {
                                if (
                                  currentBusinessId &&
                                  await confirmDelete({ kind: 'worker', id: emp.id, businessId: currentBusinessId, name: titleCase(emp.name), verb: 'Remove' })
                                ) {
                                  setIsDeletingWorker(true);
                                  try {
                                    await deleteWorker(emp.id);
                                    if (editingEmployeeId === emp.id) {
                                      handleCancelEdit();
                                    }
                                  } catch (err: any) {
                                    notify('error',
                                      toUserMessage(err, 'Failed to remove worker.'),
                                    );
                                  } finally {
                                    setIsDeletingWorker(false);
                                  }
                                }
                              };

  const cancelInvite = async (inv: any) => {
                                  if (
                                    await appDialog.confirm({
                                      title: `Cancel ${titleCase(inv.name)}'s invitation?`,
                                      message: 'The invitation and any sign-up made with it are deleted.',
                                      confirmLabel: 'Cancel invitation',
                                      cancelLabel: 'Keep',
                                      destructive: true,
                                    })
                                  ) {
                                    setIsRevokingInvite(true);
                                    try {
                                      await revokeInvitation(inv.id);
                                    } catch (err: any) {
                                      notify('error',
                                        toUserMessage(err, 'Failed to revoke invitation.'),
                                      );
                                    } finally {
                                      setIsRevokingInvite(false);
                                    }
                                  }
                                };

  const removeInvite = async (inv: any, displayStatus: string) => {
                                  if (
                                    await appDialog.confirm({
                                      title: 'Remove this invitation?',
                                      message: `It's ${displayStatus.toLowerCase()} and is removed from the list.`,
                                      confirmLabel: 'Remove',
                                      destructive: true,
                                    })
                                  ) {
                                    setIsRevokingInvite(true);
                                    try {
                                      await revokeInvitation(inv.id);
                                    } catch (err: any) {
                                      notify('error',
                                        toUserMessage(err, 'Failed to remove invitation.'),
                                      );
                                    } finally {
                                      setIsRevokingInvite(false);
                                    }
                                  }
                                };

  const handleStartEdit = (emp: any) => {
    setEditingEmployeeId(emp.id);
    setName(emp.name);
    setEmail(emp.email);
    setRole(emp.role);
    setSelectedAvatar(emp.avatar);
    setSuccessMsg("");
    setErrorMsg("");

    // Auto-detect country code from E.164
    const matchedCountry = SUPPORTED_COUNTRIES.find(c => emp.phone.startsWith(c.code));
    if (matchedCountry) {
      setSelectedCountryCode(matchedCountry.code);
      setPhone(emp.phone.slice(matchedCountry.code.length));
    } else {
      setSelectedCountryCode("+254");
      setPhone(emp.phone);
    }

    // Bring the form into view (it sits above the list on phones) and put the cursor in it.
    requestAnimationFrame(() => {
      formBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      nameInputRef.current?.focus({ preventScroll: true });
    });
  };

  const handleCancelEdit = () => {
    setEditingEmployeeId(null);
    setName("");
    setEmail("");
    setPhone("");
    setSelectedCountryCode("+254");
    setRole("Cashier");
    setSelectedAvatar(PRESET_AVATARS[0].url);
    setSuccessMsg("");
    setErrorMsg("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSuccessMsg("");
    setErrorMsg("");

    if (!name.trim() || (!email.trim() && !isSupplier) || !phone.trim()) {
      notify('error', isSupplier ? "Fill in the name and phone number." : "Fill in the name, email and phone number.");
      setIsSubmitting(false);
      return;
    }
    if (isSupplier && supplierId === 'new' && !supplierSupplies.trim()) {
      notify('error', "Say what they supply, e.g. Flour, Packaging.");
      setIsSubmitting(false);
      return;
    }

    const fullPhone = normalizePhone(phone, selectedCountryCode);
    if (!validatePhone(fullPhone)) {
      notify('error', "Check the phone number for the selected country.");
      setIsSubmitting(false);
      return;
    }

    try {
      if (isSupplier) {
        if (!handlesSuppliers || !currentBusinessId) return;
        // A new supplier is added to the list first; then whoever has an email is invited.
        let id = supplierId;
        if (id === 'new') {
          id = await saveSupplier(currentBusinessId, {
            name: name.trim(), company: supplierCompany.trim(), phone: fullPhone, email: email.trim(),
            productSupplied: supplierSupplies.trim(), notes: '',
          }, undefined, currentEmployee?.name || 'staff');
        }
        const company = supplierCompany.trim() || suppliers.find((x) => x.id === id)?.company || suppliers.find((x) => x.id === id)?.name || name.trim();
        if (supplierId !== 'new' && !email.trim()) {
          notify('error', "Add their email to invite them.");
          return;
        }
        if (email.trim() && canInviteSuppliers) {
          const code = await inviteSupplierUser(id, name.trim(), email.trim(), activeBusinessName);
          notify('success', `Invitation sent to ${email.trim()} (code ${code}). They will see only ${company}'s orders and payments.`);
        } else {
          notify('success', `${company} added to your suppliers. Add an email later to let them sign in.`);
        }
        setName(""); setEmail(""); setPhone(""); setSelectedCountryCode("+254");
        setSupplierId('new'); setSupplierCompany(''); setSupplierSupplies('');
        setSuppliersRefresh((n) => n + 1);
        return;
      }
      if (editingEmployeeId) {
        // Modify active worker profile
        await updateProfile(editingEmployeeId, {
          name: name.trim(),
          email: email.trim(),
          phone: fullPhone,
          role: role,
          avatar: selectedAvatar
        });

        handleCancelEdit();
        notify('success', `Saved ${titleCase(name)}'s details.`);
      } else {
        // Send secure invitation
        const res = await inviteUser(name.trim(), email.trim(), fullPhone, role);
        if (res.success && res.invitation) {
          notify('success', `Invitation sent to ${email.trim()}.`);
          setName("");
          setEmail("");
          setPhone("");
          setSelectedCountryCode("+254");
          setRole("Cashier");
        } else {
          notify('error', res.error || "The invitation couldn't be sent.");
        }
      }
    } catch (err: any) {
      notify('error', toUserMessage(err, "Something went wrong. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Invitation code copied", "", undefined, "success");
  };

  // Filter invitations for current business
  const filteredInvitations = invitations.filter(inv => inv.businessId === currentBusinessId);

  return (
    <div
      id="workers-panel"
      className="h-full overflow-y-auto p-4 pb-nav space-y-5 bg-app-bg text-app-text font-sans"
    >
      {/* Title block */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h2 className="text-sm font-semibold font-display text-app-text flex items-center gap-1.5">
            <Shield size={16} className="text-amber-500" /> Workers
          </h2>
          <p className="text-[11px] text-app-text-muted mt-0.5">
            Invite people to work with you and choose what each person can do.
          </p>
        </div>
       
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Form Box (Invite or Edit depending on state) */}
        <div ref={formBoxRef} className={`lg:col-span-1 bg-app-card border rounded-2xl p-4 shadow-sm self-start scroll-mt-4 transition-colors ${editingEmployeeId ? 'border-amber-500 ring-1 ring-amber-500/30' : 'border-app-border'}`}>
          {canInviteStaff || canUpdateStaff || handlesSuppliers ? (
            <>
              <div className="flex items-center justify-between mb-3 border-b border-app-border/40 pb-2">
                <h3 className="text-xs font-bold text-app-text flex items-center gap-1.5">
                  <UserPlus size={14} className="text-amber-500" />
                  {editingEmployeeId
                    ? 'Edit team member'
                    : 'Invite someone'}
                </h3>
                {editingEmployeeId && (
                  <button
                    onClick={handleCancelEdit}
                    className="p-1 hover:bg-app-bg text-app-text-muted hover:text-red-500 rounded-lg transition"
                    title="Cancel Edit"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
                {/* Full Name */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold block">
                    Full Name *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      ref={nameInputRef}
                      placeholder="e.g. Kipchoge Keino"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
                    />
                    <User
                      size={13}
                      className="absolute left-3 top-3.5 text-app-text-muted"
                    />
                  </div>
                </div>

                {/* Email Address */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold block">
                    {isSupplier ? 'Email (to sign in; leave empty to only add them)' : 'Email Address *'}
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="e.g. kid@yourshop.co.ke"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
                    />
                    <Mail
                      size={13}
                      className="absolute left-3 top-3.5 text-app-text-muted"
                    />
                  </div>
                </div>

                {/* Phone Number */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold block">
                    Phone Number *
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    <SearchableDropdown
                      items={SUPPORTED_COUNTRIES.map((c) => ({
                        id: c.code,
                        label: ` ${c.flag} ${c.code}`,
                      }))}
                      selectedValue={selectedCountryCode}
                      onChange={(val) => setSelectedCountryCode(val)}
                      placeholder="Code"
                      className="w-28 shrink-0 col-span-2"
                    />
                    <div className="relative col-span-3 flex-1">
                      <input
                        type="tel"
                        placeholder="e.g. 712345678"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20 text-xs font-bold"
                      />
                      <Phone
                        size={13}
                        className="absolute left-3 top-3.5 text-app-text-muted"
                      />
                    </div>
                  </div>
                  <span className="text-[11px] text-app-text-muted block mt-1">
                    Stored E.164: {normalizePhone(phone, selectedCountryCode)}
                  </span>
                </div>

                {/* System Role Selection */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold block">
                    Role *
                  </label>
                  <SearchableDropdown
                    items={roleOptions}
                    selectedValue={role}
                    onChange={(val) => setRole(val as EmployeeRole)}
                    placeholder="Choose a role"
                  />
                  {selectedRoleInfo?.description && (
                    <p className="text-[11px] text-app-text-muted leading-snug">{selectedRoleInfo.description}</p>
                  )}
                </div>

                {isSupplier && (
                  <div className="space-y-3 p-3 rounded-xl bg-app-bg border border-app-border">
                    <div className="space-y-1">
                      <label className="text-[10px] text-app-text-muted font-bold block">Supplier *</label>
                      <SearchableDropdown
                        items={[{ id: 'new', label: '+ A new supplier' }, ...suppliers.map((x) => ({ id: x.id, label: x.company ? `${x.company} (${x.name})` : x.name }))]}
                        selectedValue={supplierId}
                        onChange={(val) => setSupplierId(val)}
                        placeholder="Choose a supplier"
                      />
                    </div>
                    {supplierId === 'new' && (
                      <>
                        <div className="space-y-1">
                          <label className="text-[10px] text-app-text-muted font-bold block">Company (optional)</label>
                          <input value={supplierCompany} onChange={(e) => setSupplierCompany(e.target.value)} placeholder="e.g. Mwangi Distributors" maxLength={80}
                            className="w-full bg-app-card text-app-text px-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-app-text-muted font-bold block">What they supply *</label>
                          <input value={supplierSupplies} onChange={(e) => setSupplierSupplies(e.target.value)} placeholder="e.g. Flour, Packaging, Sugar" maxLength={80}
                            className="w-full bg-app-card text-app-text px-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none" />
                        </div>
                      </>
                    )}
                    <p className="text-[11px] text-app-text-muted leading-snug">
                      With an email they get a code to sign in and see only their own orders, price requests, deliveries and payments.
                      {!canInviteSuppliers && ' Only the owner or an admin can send the invitation; you can add the supplier.'}
                    </p>
                  </div>
                )}

                {editingEmployeeId && (
                  <>
                    {/* Custom Profile Image Upload */}
                    <div className="space-y-2 pt-2 border-t border-app-border/40">
                      <label className="text-[10px] text-app-text-muted font-bold block">
                        Custom Profile Image
                      </label>
                      <div className="flex items-center gap-3 bg-app-bg p-2 rounded-xl border border-app-border">
                        <img
                          src={selectedAvatar}
                          alt="Avatar preview"
                          className="w-10 h-10 rounded-lg object-cover border border-amber-500/20 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <UnifiedUploader
                          onUploadSuccess={(url) => setSelectedAvatar(url)}
                          allowedTypes={['image']}
                          cropAspect={1}
                          cropRequired
                          buttonText="Upload Picture"
                          bucketName="employee-avatars"
                          className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 font-semibold text-[11px] rounded-lg transition text-center w-full select-none cursor-pointer"
                        />
                      </div>
                    </div>

                   
                  </>
                )}

                {/* Result of the last save, right where you pressed the button */}
                {successMsg && (
                  <div role="status" className="p-2.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs flex items-start gap-2 animate-fade-in">
                    <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                    <span>{successMsg}</span>
                  </div>
                )}
                {errorMsg && (
                  <div role="alert" className="p-2.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-xs flex items-start gap-2 animate-fade-in">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-xl transition cursor-pointer flex items-center justify-center gap-2 mt-4"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>{editingEmployeeId ? 'Saving…' : 'Sending…'}</span>
                    </>
                  ) : (
                    <>
                      {editingEmployeeId ? (
                        <Edit size={14} />
                      ) : (
                        <Send size={14} />
                      )}
                      {editingEmployeeId
                        ? 'Save changes'
                        : isSupplier && !email.trim()
                          ? 'Add supplier'
                          : 'Send invitation'}
                    </>
                  )}
                </button>
              </form>
            </>
          ) : (
            <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-2xl space-y-2.5">
              <Shield className="text-amber-500 " size={18} />
              <h4 className="text-xs font-bold text-app-text">
                You can't invite people
              </h4>
              <p className="text-[11px] text-app-text-muted leading-relaxed">
                As <strong>{currentEmployee?.role}</strong> you can see the team. Ask the admin to
                invite people or change roles.
              </p>
            </div>
          )}
        </div>

        {/* Workers List View Box */}
        <div className="lg:col-span-2 space-y-5">
          {/* ACTIVE TEAM */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3 font-sans">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app-border/40 pb-3">
              <h3 className="text-xs font-bold text-app-text flex items-center gap-1.5">
                <Shield size={14} className="text-amber-500" /> Team ({employees.length})
              </h3>

              {/* Local Search input */}
              <div className="relative max-w-xs w-full sm:w-60">
                <Search
                  size={12}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-app-text-muted"
                />
                <input
                  type="text"
                  placeholder="Search staff, email, phone, role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-app-bg text-[10px] font-semibold pl-8 pr-8 py-1.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-app-text-muted hover:text-app-text"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
              {employees
                .filter((emp) => {
                  return (
                    searchMatch(emp.name, searchQuery) ||
                    searchMatch(emp.role, searchQuery) ||
                    searchMatch(emp.email, searchQuery) ||
                    searchMatch(emp.phone, searchQuery)
                  );
                })
                .map((emp) => {
                  const isOwner = emp.role === 'Owner';
                  const isSelf = emp.id === currentEmployee?.id;

                  // Only the Owner or an Admin removes or changes an Admin (the database refuses others).
                  const isTopMember = ['Owner', 'Admin', 'Administrator'].includes(emp.role);
                  const guarded = isOwner || (isTopMember && !callerIsTop);
                  const canRemoveThis = !guarded && !isSelf && canRemoveStaff;
                  const canEditThis = canUpdateStaff && (isSelf || !isTopMember || callerIsTop);
                  return (
                    <SwipeRow
                      key={emp.id}
                      searchId={`worker-${emp.id}`}
                      title={titleCase(emp.name)}
                      subtitle={`${emp.role}${emp.phone ? ` · ${emp.phone}` : ''}`}
                      surfaceClassName="bg-app-bg"
                      actions={[
                        { label: 'Remove', icon: <Trash2 size={18} />, tone: 'red', hidden: !canRemoveThis, disabled: isDeletingWorker, onClick: () => removeWorker(emp) },
                      ]}
                      more={[
                        { label: 'Edit role and details', icon: <Edit size={16} />, hidden: !canEditThis, onClick: () => handleStartEdit(emp) },
                        { label: 'Copy phone number', icon: <Phone size={16} />, hidden: !emp.phone, onClick: () => copyToClipboard(emp.phone) },
                        { label: 'Copy email', icon: <Mail size={16} />, hidden: !emp.email, onClick: () => copyToClipboard(emp.email) },
                        { label: 'Remove from business', icon: <Trash2 size={16} />, tone: 'red', hidden: !canRemoveThis, disabled: isDeletingWorker, onClick: () => removeWorker(emp) },
                      ]}
                      className="border border-app-border/70 rounded-xl hover:border-app-border transition-colors shadow-xs"
                      contentClassName="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 gap-3"
                    >
                      {/* Avatar and Primary Credentials */}
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            emp.avatar ||
                            'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200'
                          }
                          alt={emp.name}
                          className="w-9 h-9 rounded-xl object-cover border border-amber-500/15 shrink-0 shadow-xs"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <h4 className="text-xs font-semibold text-app-text flex items-center gap-1.5 leading-snug">
                            {titleCase(emp.name)}
                            {isSelf && (
                              <span className="text-[11px] bg-slate-200 dark:bg-slate-800 text-app-text px-1 py-0.2 rounded font-bold">
                                You
                              </span>
                            )}
                            <span
                              className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                                isOwner
                                  ? 'bg-amber-500/10 text-amber-500'
                                  : emp.role === 'Manager'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : emp.role === 'Cashier'
                                  ? 'bg-emerald-500/10 text-emerald-500'
                                  : 'bg-purple-500/10 text-purple-500'
                              }`}
                            >
                              {emp.role}
                            </span>
                          </h4>

                          <div className="flex flex-col gap-0.5 mt-1 text-[11px] text-app-text-muted font-semibold">
                            <span className="flex items-center gap-1">
                              <Mail size={8} /> {emp.email}
                            </span>
                            <span className="flex items-center gap-1">
                              <Phone size={8} /> {emp.phone}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions (Edit/Delete) */}
                      {(canUpdateStaff || canRemoveStaff) && (
                        <div className="flex items-center gap-1 border-t sm:border-t-0 border-app-border/40 pt-2 sm:pt-0 shrink-0 w-full sm:w-auto justify-end">
                          {/* Edit Button */}
                          {canEditThis && (
                          <button
                            onClick={() => handleStartEdit(emp)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-lg transition cursor-pointer"
                            title="Edit Worker Permissions"
                          >
                            <Edit size={11} />
                          </button>
                          )}

                          {/* Delete Button (cannot delete self or owners) */}
                          {canRemoveThis && (
                            <button
                              disabled={isDeletingWorker}
                              onClick={() => removeWorker(emp)}
                              className="p-1.5 bg-red-500/5 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed text-red-500 rounded-lg transition cursor-pointer"
                              title="Revoke Membership"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      )}
                    </SwipeRow>
                  );
                })}
            </div>
          </div>

          {/* JOIN CODE: people with an account ask to join; someone lets them in */}
          {canInviteStaff && currentBusinessId && <JoinCodePanel businessId={currentBusinessId} />}

          {/* PENDING INVITATIONS */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3 font-sans">
            <div className="border-b border-app-border/40 pb-2.5">
              <h3 className="text-xs font-bold text-app-text flex items-center gap-1.5">
                <Clock size={14} className="text-amber-500 " /> Invitations ({filteredInvitations.length})
              </h3>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {filteredInvitations.length === 0 ? (
                <div className="p-6 text-center text-[10px] text-app-text-muted font-bold italic">
                  No invitations yet. Use "Send invitation" to invite someone.
                </div>
              ) : (
                filteredInvitations.map((inv) => {
                  const isExpired =
                    new Date(inv.expiresAt).getTime() < Date.now();
                  const displayStatus =
                    isExpired && inv.status === 'Pending'
                      ? 'Expired'
                      : inv.status;

                  const pending = inv.status === 'Pending' && !isExpired;
                  return (
                    <SwipeRow
                      key={inv.id}
                      searchId={`invitation-${inv.id}`}
                      title={`${titleCase(inv.name)}'s invitation`}
                      subtitle={`${inv.role} · ${displayStatus}`}
                      surfaceClassName="bg-app-bg"
                      actions={[
                        pending
                          ? { label: 'Revoke', icon: <Ban size={18} />, tone: 'red', hidden: !canDeleteInvite, disabled: isRevokingInvite, onClick: () => cancelInvite(inv) }
                          : { label: 'Delete', icon: <Trash2 size={18} />, tone: 'red', hidden: !canDeleteInvite, disabled: isRevokingInvite, onClick: () => removeInvite(inv, displayStatus) },
                      ]}
                      more={[
                        { label: 'Copy invitation code', icon: <Copy size={16} />, onClick: () => copyToClipboard(inv.invitationToken) },
                        pending
                          ? { label: 'Revoke invitation', icon: <Ban size={16} />, tone: 'red', hidden: !canDeleteInvite, disabled: isRevokingInvite, onClick: () => cancelInvite(inv) }
                          : { label: 'Delete invitation', icon: <Trash2 size={16} />, tone: 'red', hidden: !canDeleteInvite, disabled: isRevokingInvite, onClick: () => removeInvite(inv, displayStatus) },
                      ]}
                      className="border border-app-border/50 rounded-xl"
                      contentClassName="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-semibold text-app-text truncate">
                            {titleCase(inv.name)}
                          </h4>
                          <span className="text-[11px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 rounded">
                            {inv.role}
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-1.5 rounded ${
                              displayStatus === 'Accepted'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : displayStatus === 'Revoked'
                                ? 'bg-red-500/10 text-red-500'
                                : displayStatus === 'Expired'
                                ? 'bg-slate-300/20 text-slate-400'
                                : 'bg-amber-500/10 text-amber-500 '
                            }`}
                          >
                            {displayStatus}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-1 text-[11px] text-app-text-muted font-semibold">
                          <span>Email: {inv.email}</span>
                          <span>Phone: {inv.phone}</span>
                          <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 p-0.5 rounded px-1 text-slate-500 select-all flex items-center gap-1 w-max mt-1">
                            Code: {inv.invitationToken}
                            <button
                              type="button"
                              aria-label="Copy invitation code"
                              onClick={() => copyToClipboard(inv.invitationToken)}
                              className="hover:text-amber-500 text-slate-400"
                            >
                              <Copy size={9} />
                            </button>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {inv.status === 'Pending' && !isExpired
                          ? canDeleteInvite && (
                              <button
                                disabled={isRevokingInvite}
                                onClick={() => cancelInvite(inv)}
                                className="px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-500/5 border border-red-500/10 hover:border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
                              >
                                Revoke
                              </button>
                            )
                          : canDeleteInvite && (
                              <button
                                disabled={isRevokingInvite}
                                onClick={() => removeInvite(inv, displayStatus)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition"
                                title="Delete from view"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                      </div>
                    </SwipeRow>
                  );
                })
              )}
            </div>
          </div>

          {handlesSuppliers && (
            <SuppliersTeamCard canManage={canInviteSuppliers} onInvite={(sup) => startSupplierInvite(sup)} refreshKey={suppliersRefresh} />
          )}
        </div>
      </div>
    </div>
  );
}
