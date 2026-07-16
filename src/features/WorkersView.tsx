import React, { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { UserPlus, Trash2, CheckCircle2, AlertCircle, Shield, Mail, Phone, User, Edit, X, Camera, Search, Send, Copy, Clock, RefreshCw } from "lucide-react";
import SearchableDropdown from "../components/SearchableDropdown";
import { normalizePhone, validatePhone, SUPPORTED_COUNTRIES } from "../utils/phoneUtils";
import { titleCase, searchMatch, formatName } from "../utils/stringUtils";
import UnifiedUploader from "../components/shared/UnifiedUploader";
import { EmployeeRole } from "../types";
import { hasRolePermission } from "../utils/permissions";

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
    currentBusinessId
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

  // Invitation Branded Email Mockup display state
  const [dispatchMockup, setDispatchMockup] = useState<any | null>(null);

  // Edit employee state (for role updates)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingWorker, setIsDeletingWorker] = useState(false);
  const [isRevokingInvite, setIsRevokingInvite] = useState(false);

  const canInviteStaff = currentEmployee ? hasRolePermission(currentEmployee.role, "staff.invite") : false;
  const canUpdateStaff = currentEmployee ? hasRolePermission(currentEmployee.role, "staff.update") : false;
  const canRemoveStaff = currentEmployee ? hasRolePermission(currentEmployee.role, "staff.remove") : false;
  const canDeleteInvite = currentEmployee ? hasRolePermission(currentEmployee.role, "invitations.delete") : false;
  const activeBusinessName = businesses.find(b => b.id === currentBusinessId)?.name || "KayKay's Milk Hub";

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

    if (!name.trim() || !email.trim() || !phone.trim()) {
      setErrorMsg("Please fill in all details.");
      setIsSubmitting(false);
      return;
    }

    const fullPhone = normalizePhone(phone, selectedCountryCode);
    if (!validatePhone(fullPhone)) {
      setErrorMsg("Invalid phone number or length for the selected country.");
      setIsSubmitting(false);
      return;
    }

    try {
      if (editingEmployeeId) {
        // Modify active worker profile
        await updateProfile(editingEmployeeId, {
          name: name.trim(),
          email: email.trim(),
          phone: fullPhone,
          role: role,
          avatar: selectedAvatar
        });

        setSuccessMsg(`Successfully updated credentials and permissions for ${titleCase(name)}.`);
        handleCancelEdit();
      } else {
        // Send secure invitation
        const res = await inviteUser(name.trim(), email.trim(), fullPhone, role);
        if (res.success && res.invitation) {
          setSuccessMsg(`Branded workspace invitation successfully sent to ${email}!`);
          setDispatchMockup(res.invitation);
          setName("");
          setEmail("");
          setPhone("");
          setSelectedCountryCode("+254");
          setRole("Cashier");
        } else {
          setErrorMsg(res.error || "Failed to dispatch invitation.");
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Invitation Link copied to clipboard!");
  };

  // Filter invitations for current business
  const filteredInvitations = invitations.filter(inv => inv.businessId === currentBusinessId);

  return (
    <div id="workers-panel" className="h-full overflow-y-auto p-4 pb-24 space-y-5 bg-app-bg text-app-text font-sans">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h2 className="text-sm font-extrabold font-display text-app-text uppercase tracking-wider flex items-center gap-1.5">
            <Shield size={16} className="text-amber-500" /> Secure Staff & Invitation Command
          </h2>
          <p className="text-[11px] text-app-text-muted mt-0.5">
            Send secure branded registration invitation links to workers, manage active memberships, and set access control.
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
            Active Hub: {activeBusinessName}
          </span>
        </div>
      </div>

      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-xl text-xs flex items-start gap-2 animate-fade-in">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs flex items-start gap-2 animate-fade-in">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Form Box (Invite or Edit depending on state) */}
        <div className="lg:col-span-1 bg-app-card border border-app-border rounded-2xl p-4 shadow-sm self-start">
          {(canInviteStaff || canUpdateStaff) ? (
            <>
              <div className="flex items-center justify-between mb-3 border-b border-app-border/40 pb-2">
                <h3 className="text-xs font-bold text-app-text flex items-center gap-1.5 uppercase tracking-wider">
                  <UserPlus size={14} className="text-amber-500" /> 
                  {editingEmployeeId ? "Edit Team Member" : "Send Workspace Invitation"}
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
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider block">Full Name *</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Kipchoge Keino"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
                    />
                    <User size={13} className="absolute left-3 top-3.5 text-app-text-muted" />
                  </div>
                </div>

                {/* Email Address */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider block">Email Address *</label>
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="e.g. kid@kaykaysmilk.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20"
                    />
                    <Mail size={13} className="absolute left-3 top-3.5 text-app-text-muted" />
                  </div>
                </div>

                {/* Phone Number */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider block">Phone Number *</label>
                  <div className="grid grid-cols-4 gap-2">
                    <SearchableDropdown
                      items={SUPPORTED_COUNTRIES.map((c) => ({ id: c.code, label: `${c.flag} ${c.code}` }))}
                      selectedValue={selectedCountryCode}
                      onChange={(val) => setSelectedCountryCode(val)}
                      placeholder="Code"
                      className="w-28 shrink-0"
                    />
                    <div className="relative col-span-3 flex-1">
                      <input
                        type="tel"
                        placeholder="e.g. 712345678"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/20 text-xs font-bold"
                      />
                      <Phone size={13} className="absolute left-3 top-3.5 text-app-text-muted" />
                    </div>
                  </div>
                  <span className="text-[8.5px] text-app-text-muted block mt-1">
                    Stored E.164: {normalizePhone(phone, selectedCountryCode)}
                  </span>
                </div>

                {/* System Role Selection */}
                <div className="space-y-1">
                  <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider block">Workspace Role *</label>
                  <SearchableDropdown
                    items={[
                      { id: "Owner", label: "Owner (Full Business Owner)" },
                      { id: "Admin", label: "Admin (Total Access Controller)" },
                      { id: "Administrator", label: "Administrator" },
                      { id: "Manager", label: "Manager (Operations Supervisor)" },
                      { id: "Inventory Manager", label: "Inventory Manager" },
                      { id: "Cashier", label: "Cashier (POS Checkout)" },
                      { id: "Production Staff", label: "Production Staff" },
                      { id: "Inventory Staff", label: "Inventory Staff" },
                      { id: "Sales Staff", label: "Sales Staff" },
                      { id: "Viewer", label: "Viewer (Read Only)" },
                      { id: "Rider", label: "Rider (Courier Logistics)" },
                      { id: "Staff", label: "Staff (General Hand)" }
                    ]}
                    selectedValue={role}
                    onChange={(val) => setRole(val as EmployeeRole)}
                    placeholder="Select workspace role..."
                  />
                </div>

                {editingEmployeeId && (
                  <>
                    {/* Custom Profile Image Upload */}
                    <div className="space-y-2 pt-2 border-t border-app-border/40">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider block">Custom Profile Image</label>
                      <div className="flex items-center gap-3 bg-app-bg p-2 rounded-xl border border-app-border">
                        <img
                          src={selectedAvatar}
                          alt="Avatar preview"
                          className="w-10 h-10 rounded-lg object-cover border border-amber-500/20 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <UnifiedUploader
                          onUploadSuccess={(url) => setSelectedAvatar(url)}
                          allowedTypes={["image"]}
                          cropAspect={1}
                          buttonText="Upload Picture"
                          bucketName="employee-avatars"
                          className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600  font-black text-[9px] rounded-lg transition uppercase tracking-wider text-center w-full select-none cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Preset Avatars Selector */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-app-text-muted font-bold uppercase tracking-wider flex items-center gap-1">
                        <span>Or Select Preset Face</span>
                      </label>
                      <div className="grid grid-cols-6 gap-2 bg-app-bg p-2 rounded-xl border border-app-border">
                        {PRESET_AVATARS.map((avatar) => {
                          const isSelected = selectedAvatar === avatar.url;
                          return (
                            <button
                              key={avatar.id}
                              type="button"
                              onClick={() => setSelectedAvatar(avatar.url)}
                              className={`relative w-8 h-8 rounded-lg overflow-hidden border transition active:scale-90 cursor-pointer ${
                                isSelected ? "border-amber-500 ring-2 ring-amber-500/20 scale-105 shadow-sm" : "border-app-border opacity-70 hover:opacity-100"
                              }`}
                              title={`Assign preset for ${avatar.name}`}
                            >
                              <img
                                src={avatar.url}
                                alt={avatar.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl transition cursor-pointer flex items-center justify-center gap-2 mt-4 uppercase tracking-wider"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      {editingEmployeeId ? <Edit size={14} /> : <Send size={14} />}
                      {editingEmployeeId ? "Save Member Details" : "Dispatch Branded Invite"}
                    </>
                  )}
                </button>
              </form>
            </>
          ) : (
            <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-2xl space-y-2.5">
              <Shield className="text-amber-500 " size={18} />
              <h4 className="text-xs font-bold text-app-text uppercase tracking-wider">Registration Privilege Restriction</h4>
              <p className="text-[10px] text-app-text-muted leading-relaxed">
                Your current active role <strong>{currentEmployee?.role}</strong> is restricted to view-only. Only company <strong>Owners</strong> are authorized to invite staff or manage business memberships.
              </p>
            </div>
          )}
        </div>

        {/* Workers List View Box */}
        <div className="lg:col-span-2 space-y-5">
          
          {/* ACTIVE TEAM */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3 font-sans">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app-border/40 pb-3">
              <h3 className="text-xs font-bold text-app-text uppercase tracking-wider flex items-center gap-1.5">
                <Shield size={14} className="text-amber-500" /> Active Workspace Team ({employees.length})
              </h3>
              
              {/* Local Search input */}
              <div className="relative max-w-xs w-full sm:w-60">
                <Search size={12} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
                <input
                  type="text"
                  placeholder="Search staff, email, phone, role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-app-bg text-[10px] font-semibold pl-8 pr-8 py-1.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-app-text-muted hover:text-app-text"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
              {employees.filter(emp => {
                return searchMatch(emp.name, searchQuery) ||
                  searchMatch(emp.role, searchQuery) ||
                  searchMatch(emp.email, searchQuery) ||
                  searchMatch(emp.phone, searchQuery);
              }).map((emp) => {
                const isOwner = emp.role === "Owner";
                const isSelf = emp.id === currentEmployee?.id;
                
                return (
                  <div
                    key={emp.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-app-bg border border-app-border/70 rounded-xl gap-3 hover:border-app-border transition-colors shadow-xs"
                  >
                    {/* Avatar and Primary Credentials */}
                    <div className="flex items-center gap-3">
                      <img
                        src={emp.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200"}
                        alt={emp.name}
                        className="w-9 h-9 rounded-xl object-cover border border-amber-500/15 shrink-0 shadow-xs"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <h4 className="text-xs font-extrabold text-app-text flex items-center gap-1.5 leading-snug">
                          {titleCase(emp.name)}
                          {isSelf && (
                            <span className="text-[8px] bg-slate-200 dark:bg-slate-800 text-app-text px-1 py-0.2 rounded uppercase font-bold tracking-wider">
                              You
                            </span>
                          )}
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider ${
                            isOwner 
                              ? "bg-amber-500/10 text-amber-500" 
                              : emp.role === "Manager"
                              ? "bg-blue-500/10 text-blue-500"
                              : emp.role === "Cashier"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : "bg-purple-500/10 text-purple-500"
                          }`}>
                            {emp.role}
                          </span>
                        </h4>
                        
                        <div className="flex flex-col gap-0.5 mt-1 text-[9px] text-app-text-muted font-semibold">
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
                        <button
                          onClick={() => handleStartEdit(emp)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-lg transition cursor-pointer"
                          title="Edit Worker Permissions"
                        >
                          <Edit size={11} />
                        </button>

                        {/* Delete Button (cannot delete self or owners) */}
                        {!isOwner && !isSelf && canRemoveStaff && (
                          <button
                            disabled={isDeletingWorker}
                            onClick={async () => {
                              if (confirm(`Are you sure you want to remove ${titleCase(emp.name)} from this business workspace?`)) {
                                setIsDeletingWorker(true);
                                try {
                                  await deleteWorker(emp.id);
                                  if (editingEmployeeId === emp.id) {
                                    handleCancelEdit();
                                  }
                                } catch (err: any) {
                                  setErrorMsg(err.message || "Failed to remove worker.");
                                } finally {
                                  setIsDeletingWorker(false);
                                }
                              }
                            }}
                            className="p-1.5 bg-red-500/5 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed text-red-500 rounded-lg transition cursor-pointer"
                            title="Revoke Membership"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* PENDING INVITATIONS */}
          <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col gap-3 font-sans">
            <div className="border-b border-app-border/40 pb-2.5">
              <h3 className="text-xs font-bold text-app-text uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={14} className="text-amber-500 " /> Pending Invites & Tokens ({filteredInvitations.length})
              </h3>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {filteredInvitations.length === 0 ? (
                <div className="p-6 text-center text-[10px] text-app-text-muted font-bold italic">
                  No pending invitations. Click "Dispatch Branded Invite" to invite your employees.
                </div>
              ) : (
                filteredInvitations.map((inv) => {
                  const isExpired = new Date(inv.expiresAt).getTime() < Date.now();
                  const displayStatus = isExpired && inv.status === "Pending" ? "Expired" : inv.status;
                  
                  return (
                    <div
                      key={inv.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-app-bg border border-app-border/50 rounded-xl gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-extrabold text-app-text truncate">{titleCase(inv.name)}</h4>
                          <span className="text-[8px] font-black uppercase text-amber-500 bg-amber-500/10 px-1.5 rounded">
                            {inv.role}
                          </span>
                          <span className={`text-[7px] font-black uppercase px-1.5 rounded ${
                            displayStatus === "Accepted"
                              ? "bg-emerald-500/10 text-emerald-500"
                              : displayStatus === "Revoked"
                              ? "bg-red-500/10 text-red-500"
                              : displayStatus === "Expired"
                              ? "bg-slate-300/20 text-slate-400"
                              : "bg-amber-500/10 text-amber-500 "
                          }`}>
                            {displayStatus}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-1 text-[9px] text-app-text-muted font-semibold">
                          <span>Email: {inv.email}</span>
                          <span>Phone: {inv.phone}</span>
                          <span className="font-mono text-[8px] bg-slate-100 dark:bg-slate-800 p-0.5 rounded px-1 text-slate-500 select-all flex items-center gap-1 w-max mt-1">
                            Token: {inv.invitationToken}
                            <button 
                              onClick={() => copyToClipboard(`${window.location.origin}/?invite=${inv.invitationToken}`)}
                              className="hover:text-amber-500 text-slate-400"
                            >
                              <Copy size={9} />
                            </button>
                          </span>
                        </div>
                      </div>

                      {inv.status === "Pending" && !isExpired && canDeleteInvite && (
                        <button
                          disabled={isRevokingInvite}
                          onClick={async () => {
                            if (confirm(`Are you sure you want to revoke invitation for ${titleCase(inv.name)}? This token will immediately expire.`)) {
                              setIsRevokingInvite(true);
                              try {
                                await revokeInvitation(inv.id);
                              } catch (err: any) {
                                setErrorMsg(err.message || "Failed to revoke invitation.");
                              } finally {
                                setIsRevokingInvite(false);
                              }
                            }
                          }}
                          className="px-2 py-1 text-[9px] font-bold text-red-500 hover:bg-red-500/5 border border-red-500/10 hover:border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
