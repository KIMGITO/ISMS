import React, { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { 
  User, Mail, Phone, Lock, Eye, EyeOff, ShieldCheck, 
  CheckCircle2, AlertCircle,  Upload, Image as ImageIcon,
  LogOut, HelpCircle, RefreshCw
} from "lucide-react";
import { hasRolePermission, ALL_PERMISSIONS } from "../utils/permissions";
import { normalizePhone, validatePhone } from "../utils/phoneUtils";
import UnifiedUploader from "../components/shared/UnifiedUploader";
import { formatName } from "../utils/stringUtils";

const PRESET_AVATARS = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150", // Amber / Owner
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150", // David
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150", // Jane
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150", // John
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=150", // Alice
  "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=150", // Michael
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=150", // Sarah
  "https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&q=80&w=150"  // Robert
];

interface ProfileViewProps {
  onRestartTour?: () => void;
}

export default function ProfileView({ onRestartTour }: ProfileViewProps = {}) {
  const { currentEmployee, updateProfile, showToast, logout } = useAppStore();
  
  const [name, setName] = useState(currentEmployee?.name || "");
  const [email] = useState(currentEmployee?.email || ""); // Protected email, no setEmail needed
  const [phone, setPhone] = useState(currentEmployee?.phone || "");
  const [pin, setPin] = useState(currentEmployee?.pin || "");
  const [currentPin, setCurrentPin] = useState(""); // input to verify the existing PIN
  const [avatar, setAvatar] = useState(currentEmployee?.avatar || "");
  const [showPin, setShowPin] = useState(false);
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [showPresetAvatars, setShowPresetAvatars] = useState(false);
  const [showSecurityClearance, setShowSecurityClearance] = useState(false);

  // Sync state values when currentEmployee changes
  React.useEffect(() => {
    if (currentEmployee) {
      setName(currentEmployee.name);
      setPhone(currentEmployee.phone);
      setPin(currentEmployee.pin || "");
      setAvatar(currentEmployee.avatar || "");
    }
  }, [currentEmployee]);

  if (!currentEmployee) {
    return (
      <div className="p-8 text-center text-app-text-muted font-sans">
        No active worker profile detected. Please log in first.
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setSuccess("");
    setError("");

    // Required details
    if (!name.trim() || !phone.trim()) {
      setError("Name and Phone cannot be blank.");
      return;
    }

    const normalizedPhone = normalizePhone(phone);
    if (!validatePhone(normalizedPhone)) {
      setError("Please enter a valid phone number (e.g. +254712345678 or 0712345678).");
      return;
    }

    const isNameChanged = name.trim() !== currentEmployee.name;
    const isPhoneChanged = normalizedPhone !== currentEmployee.phone;
    const isAvatarChanged = avatar.trim() !== currentEmployee.avatar;

    if (!isNameChanged && !isPhoneChanged && !isAvatarChanged) {
      setError("No details have been changed.");
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile(currentEmployee.id, {
        name: formatName(name),
        email: currentEmployee.email, // email is protected and remains original
        phone: normalizedPhone,
        avatar: avatar.trim() || undefined
      });

      setSuccess("Your profile details have been updated successfully!");
      showToast("Profile Settings", "Profile updated successfully!", avatar);
    } catch (err: any) {
      setError(err.message || "An error occurred while saving profile.");
    } finally {
      setIsSaving(false);
    }
  };

  // Check which permissions are granted to the logged-in role
  const rolePermissions = ALL_PERMISSIONS.map(p => ({
    ...p,
    granted: currentEmployee.role === "Owner" || hasRolePermission(currentEmployee.role, p.code)
  }));

  return (
    <div id="profile-panel" className="h-full overflow-y-auto p-4 pb-24 space-y-5 bg-app-bg text-app-text font-sans">
      
      {/* Title */}
      <div>
        <h2 className="text-base font-extrabold font-display text-app-text flex items-center gap-1.5">
          My Operator Profile
        </h2>
        <p className="text-[11px] text-app-text-muted mt-0.5">
          Manage your personal details, secure login PIN, and audit your digital security privileges.
        </p>
      </div>

      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-xl text-xs flex items-start gap-2 animate-fade-in">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs flex items-start gap-2 animate-fade-in">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Profile Card & Avatar Selection */}
        <div className="lg:col-span-1 bg-app-card border border-app-border rounded-2xl p-5 shadow-sm flex flex-col items-center text-center self-start gap-5">
          
          <UnifiedUploader
            onUploadSuccess={(url) => setAvatar(url)}
            allowedTypes={["image"]}
            cropAspect={1}
            bucketName="employee-avatars"
            triggerElement={
              <div className="relative group cursor-pointer">
                <img
                  src={avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150"}
                  alt={name}
                  className="w-24 h-24 rounded-2xl object-cover border-2 border-amber-500/25 group-hover:border-amber-500 transition shadow-md"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                  <Upload size={18} className="text-amber-500" />
                </div>
                <span className="absolute -bottom-2 -right-2 bg-amber-500 text-slate-950 text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                  {currentEmployee.role}
                </span>
              </div>
            }
          />

          <div className="space-y-1">
            <h3 className="text-sm font-black text-app-text uppercase">{name || "Staff Operator"}</h3>
          </div>

          {/* Preset Avatar Choices - Collapsible */}
          <div className="w-full border-t border-app-border/45 pt-4 text-left space-y-2">
            <button
              type="button"
              onClick={() => setShowPresetAvatars(!showPresetAvatars)}
              className="w-full flex items-center justify-between text-app-text hover:text-amber-500 transition cursor-pointer"
            >
              <label className="text-[9.5px] text-app-text-muted font-bold uppercase tracking-wider block cursor-pointer">Choose Preset Avatar</label>
              <span className="text-[10px] text-amber-500 font-bold hover:underline">
                {showPresetAvatars ? "Hide Avatars" : "Show Avatars"}
              </span>
            </button>
            {showPresetAvatars && (
              <div className="grid grid-cols-4 gap-2 animate-fade-in pt-1">
                {PRESET_AVATARS.map((avUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatar(avUrl)}
                    className={`relative rounded-xl overflow-hidden aspect-square border-2 transition ${
                      avatar === avUrl ? "border-amber-500 ring-2 ring-amber-500/20" : "border-transparent opacity-85 hover:opacity-100"
                    }`}
                  >
                    <img src={avUrl} alt={`Preset ${idx}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom Avatar Upload Input */}
          <div className="w-full text-left space-y-2">
            <label className="text-[9.5px] text-app-text-muted font-bold uppercase tracking-wider block">Upload Custom Photo</label>
            <UnifiedUploader
              onUploadSuccess={(url) => setAvatar(url)}
              allowedTypes={["image"]}
              cropAspect={1}
              buttonText="Upload Custom Photo"
              bucketName="employee-avatars"
              className="w-full py-2 bg-app-bg text-app-text border border-app-border rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 hover:bg-app-card transition cursor-pointer"
            />
          </div>

          {/* Logout Action */}
          <div className="w-full border-t border-app-border/45 pt-4 text-left">
            <button
              type="button"
              onClick={() => {
                logout();
                showToast("Logged Out", "Session closed successfully.", undefined, "info");
              }}
              className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl text-[11.5px] font-black flex items-center justify-center gap-2 transition duration-200 cursor-pointer uppercase tracking-wider shadow-xs"
            >
              <LogOut size={13} />
              <span>Log Out of Session</span>
            </button>
          </div>
        </div>

        {/* Update Details Form */}
        <div className="lg:col-span-2 bg-app-card border border-app-border rounded-2xl p-5 shadow-sm flex flex-col gap-4">
          <h3 className="text-xs font-bold text-app-text uppercase tracking-wider flex items-center gap-1.5 border-b border-app-border/45 pb-2">
            <User size={14} className="text-amber-500" /> Account Security & Information
          </h3>

          <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="text-[10px] text-app-text-muted font-bold uppercase block">Full Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none font-bold"
                />
                <User size={13} className="absolute left-3 top-3.5 text-app-text-muted" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-app-text-muted font-bold uppercase block flex items-center justify-between">
                <span>Email Address</span>
                <span className="text-[8px] text-amber-500 font-bold tracking-tight lowercase flex items-center gap-0.5">
                  <Lock size={8} /> locked profile email
                </span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full bg-app-bg/65 text-app-text-muted pl-8 pr-3 py-2.5 rounded-xl border border-app-border cursor-not-allowed font-medium opacity-85"
                />
                <Mail size={13} className="absolute left-3 top-3.5 text-app-text-muted" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-app-text-muted font-bold uppercase block">Phone Number</label>
              <div className="relative">
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-app-bg text-app-text pl-8 pr-3 py-2.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none font-medium"
                />
                <Phone size={13} className="absolute left-3 top-3.5 text-app-text-muted" />
              </div>
            </div>


            <div className="sm:col-span-2 flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="w-full sm:w-auto px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Save Settings...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Save Profile Settings
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

      </div>

      {/* Interactive Tour Card */}
      <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-500 rounded-xl">
            <HelpCircle size={18} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-app-text uppercase tracking-wider">Guided Walkthrough Tour</h3>
            <p className="text-[10px] text-app-text-muted mt-0.5">Need help navigating the system? Restart the operator guided tour anytime.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onRestartTour?.();
          }}
          className="w-full sm:w-auto px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-[10.5px] uppercase tracking-wider transition cursor-pointer shrink-0 shadow-sm"
        >
          Request Guide
        </button>
      </div>

      {/* Permissions Privilege Audit List - Collapsed by Default */}
      <div className="bg-app-card border border-app-border rounded-2xl p-4 shadow-sm space-y-3">
        <button
          type="button"
          onClick={() => setShowSecurityClearance(!showSecurityClearance)}
          className="w-full flex items-center justify-between text-left group cursor-pointer focus:outline-none"
        >
          <h3 className="text-xs font-bold text-app-text uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-app-border/45 flex-1 mr-4">
            <ShieldCheck size={14} className="text-amber-500" /> My Digital Security Clearances
          </h3>
          <span className="text-[11px] font-bold text-amber-500 group-hover:underline self-center">
            {showSecurityClearance ? "Collapse Clearances" : "Show All Clearances"}
          </span>
        </button>

        {showSecurityClearance && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1 animate-fade-in">
            {rolePermissions.filter(perm => perm.granted).map((perm) => (
              <div
                key={perm.code}
                className="p-3.5 rounded-xl border flex items-start gap-2.5 transition-colors bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              >
                <div className="p-1.5 rounded-lg shrink-0 bg-emerald-500/10 text-emerald-500">
                  <ShieldCheck size={13} />
                </div>
                <div>
                  <code className="text-[10px] font-mono font-black tracking-tight block">
                    {perm.code}
                  </code>
                  <p className="text-[9.5px] text-app-text-muted leading-tight mt-0.5 font-medium">
                    {perm.description}
                  </p>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider inline-block mt-1.5 bg-emerald-500/10 text-emerald-500">
                    Access Approved
                  </span>
                </div>
              </div>
            ))}
            {rolePermissions.filter(perm => perm.granted).length === 0 && (
              <div className="col-span-full p-4 text-center text-[11px] text-app-text-muted italic bg-app-bg border border-app-border rounded-xl">
                No active security clearances assigned to this profile.
              </div>
            )}
          </div>
        )}
      </div>


    </div>
  );
}
