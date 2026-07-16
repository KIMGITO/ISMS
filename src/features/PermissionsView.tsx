// src/features/PermissionsView.tsx
// Streams Single-Open Accordions, System Uniform Toasts, and Bulletproof Owner/Admin Protections

import React, { useState, useEffect } from "react";
import { getDynamicRoles, saveDynamicRoles, ALL_PERMISSIONS, PermissionCode, SYSTEM_ROLES } from "../utils/permissions";
import { ShieldCheck, ToggleLeft, ToggleRight, Info, Bot, RefreshCw, Lock, Search, X, Check, ShieldAlert, Grid, CheckSquare, ChevronDown, ChevronUp } from "lucide-react";
import { useNotificationStore } from "../stores/notificationStore";
import { useAuthStore } from "../stores/authStore";

export default function PermissionsView() {
  const { showToast } = useNotificationStore();
  const [selectedRole, setSelectedRole] = useState("Cashier");
  const dbPermissions = useAuthStore(state => state.dbPermissions);
  const [editedPermissions, setEditedPermissions] = useState<PermissionCode[]>([]);

  // Single string key state to keep only ONE accordion open at a time
  const [activeOpenCategory, setActiveOpenCategory] = useState<string>("Business & Settings");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedPerm, setHighlightedPerm] = useState<string | null>(null);

  // Helper validation rule to guard root account hierarchies
  const isRootRole = selectedRole === "Owner" || selectedRole === "Admin" || selectedRole === "Administrator";

  useEffect(() => {
    const roleDbPerms = dbPermissions
      .filter(p => p.role === selectedRole && p.granted)
      .map(p => p.permission as PermissionCode);
    
    const hasDbRecords = dbPermissions.some(p => p.role === selectedRole);
    if (hasDbRecords) {
      setEditedPermissions(roleDbPerms);
    } else {
      const defaultPerms = SYSTEM_ROLES[selectedRole]?.permissions || [];
      setEditedPermissions(defaultPerms);
    }
  }, [selectedRole, dbPermissions]);

  useEffect(() => {
    const handleGlobalTrigger = () => {
      const target = localStorage.getItem("kkm_perm_search_target");
      if (target) {
        setSearchQuery(target);
        setHighlightedPerm(target);
        
        const found = ALL_PERMISSIONS.find(p => p.code === target);
        if (found) {
          setActiveOpenCategory(found.category);
        }

        setTimeout(() => {
          const el = document.getElementById(`perm-code-${target}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 400);

        setTimeout(() => {
          setHighlightedPerm(null);
          localStorage.removeItem("kkm_perm_search_target");
        }, 5000);
      }
    };

    window.addEventListener("kkm_perm_search_trigger", handleGlobalTrigger);
    handleGlobalTrigger();

    return () => {
      window.removeEventListener("kkm_perm_search_trigger", handleGlobalTrigger);
    };
  }, []);

  const handleTogglePermission = (code: PermissionCode) => {
    if (isRootRole) {
      showToast("Access Denied", "Root administrator positions hold mandatory system clearances and cannot be modified.", undefined, "error" as any);
      return;
    }
    if (editedPermissions.includes(code)) {
      setEditedPermissions(editedPermissions.filter(p => p !== code));
    } else {
      setEditedPermissions([...editedPermissions, code]);
    }
  };

  const handleGrantAll = () => {
    if (isRootRole) {
      showToast("Access Denied", "Root administrator positions hold mandatory system clearances and cannot be modified.", undefined, "error" as any);
      return;
    }
    const allCodes = ALL_PERMISSIONS.map(p => p.code);
    setEditedPermissions(allCodes);
    showToast("Privileges Granted", `All system privileges assigned to "${selectedRole}". Save changes to commit.`, undefined, "info" as any);
  };

  const handleRevokeAll = () => {
    if (isRootRole) {
      showToast("Access Denied", "Root administrator positions hold mandatory system clearances and cannot be modified.", undefined, "error" as any);
      return;
    }
    setEditedPermissions([]);
    showToast("Privileges Revoked", `Cleared all privilege configurations from "${selectedRole}". Save changes to commit.`, undefined, "warning" as any);
  };

  const handleGrantViewOnly = () => {
    if (isRootRole) {
      showToast("Access Denied", "Root administrator positions hold mandatory system clearances and cannot be modified.", undefined, "error" as any);
      return;
    }
    const viewCodes = ALL_PERMISSIONS.filter(p => p.code.endsWith(".view") || p.code.includes("view_all") || p.code === "ai.use").map(p => p.code);
    setEditedPermissions(viewCodes);
    showToast("View-Only Restricted", `Applied strict view-only configurations to "${selectedRole}". Save changes to commit.`, undefined, "info" as any);
  };

  const handleToggleModule = (category: string) => {
    if (isRootRole) {
      showToast("Access Denied", "Root administrator positions hold mandatory system clearances and cannot be modified.", undefined, "error" as any);
      return;
    }
    const modulePerms = ALL_PERMISSIONS.filter(p => p.category === category).map(p => p.code);
    const hasAll = modulePerms.every(p => editedPermissions.includes(p));

    if (hasAll) {
      setEditedPermissions(editedPermissions.filter(p => !modulePerms.includes(p)));
    } else {
      const added = [...editedPermissions];
      modulePerms.forEach(p => {
        if (!added.includes(p)) added.push(p);
      });
      setEditedPermissions(added);
    }
  };

  const handleSave = async () => {
    // Save to local storage for backwards compatibility
    const currentRoles = getDynamicRoles();
    const updatedRoles = {
      ...currentRoles,
      [selectedRole]: {
        name: selectedRole,
        description: SYSTEM_ROLES[selectedRole]?.description || "",
        permissions: editedPermissions,
      }
    };
    saveDynamicRoles(updatedRoles);

    // Save to Supabase
    await useAuthStore.getState().saveRolePermissions(selectedRole, editedPermissions);
  };

  const handleReset = () => {
    if (isRootRole) {
      showToast("Access Denied", "Root administrator positions hold mandatory system clearances and cannot be modified.", undefined, "error" as any);
      return;
    }
    const defaultPerms = SYSTEM_ROLES[selectedRole]?.permissions || [];
    setEditedPermissions(defaultPerms);
    showToast(
      "Defaults Restored",
      `System baseline credentials successfully re-applied for the "${selectedRole}" profile. Click save to finalize.`,
      undefined,
      "success"
    );
  };

  const categories = Array.from(new Set(ALL_PERMISSIONS.map(p => p.category)));

  const filteredPermissions = ALL_PERMISSIONS.filter(p => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase();
    return p.code.toLowerCase().includes(term) || p.description.toLowerCase().includes(term);
  });

  return (
    <div id="permissions-panel" className="h-full overflow-y-auto p-4 pb-24 space-y-5 bg-app-bg text-app-text font-sans">
      
      <div>
        <h2 className="text-base font-extrabold font-display text-app-text flex items-center gap-2">
          Centralized Privilege Settings
        </h2>
        <p className="text-[11px] text-app-text-muted">
          Configure security credentials and roles dynamically. Grant or restrict specific functional modules. Settings take effect instantly across views and the workspace assistant.
        </p>
      </div>

      {/* Role Picker Dashboard Grid */}
      <div className="bg-app-card border border-app-border rounded-2xl p-4 space-y-3 shadow-xs">
        <span className="text-[9px] text-app-text-muted font-bold uppercase tracking-wider block">
          Select Role to Configure
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {Object.keys(SYSTEM_ROLES).map((roleName) => {
            const isActive = selectedRole === roleName;
            return (
              <button
                key={roleName}
                type="button"
                onClick={() => setSelectedRole(roleName)}
                className={`py-2 px-3 rounded-xl text-[10px] font-bold text-center border transition-all cursor-pointer truncate ${
                  isActive
                    ? "bg-amber-500 text-slate-950 border-amber-500 font-extrabold shadow-sm"
                    : "bg-app-bg border-app-border hover:border-app-border/80 text-app-text-muted hover:text-app-text"
                }`}
                title={SYSTEM_ROLES[roleName].description}
              >
                {roleName}
              </button>
            );
          })}
        </div>

        <div className="p-3 bg-app-bg border border-app-border/45 rounded-xl text-[10px] leading-relaxed text-app-text-muted flex gap-2 items-start">
          <Lock size={12} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-app-text">{selectedRole} description:</span>{" "}
            {SYSTEM_ROLES[selectedRole]?.description}
            {isRootRole && (
              <span className="text-amber-500 block font-black mt-1 uppercase tracking-wider ">
                Note: This administrator role has root privileges and bypasses all permissions. Manual modifications are disabled.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Search and Bulk Selection Bar */}
      <div className="bg-app-card border border-app-border rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-app-text-muted" />
          <input
            type="text"
            placeholder="Search permissions (e.g. mpesa, wastage)..."
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setSearchQuery(val);
              if (val.trim()) {
                const term = val.toLowerCase();
                const matched = ALL_PERMISSIONS.find(p => p.code.toLowerCase().includes(term) || p.description.toLowerCase().includes(term));
                if (matched) setActiveOpenCategory(matched.category);
              }
            }}
            className="w-full bg-app-bg text-[10.5px] font-medium pl-8 pr-8 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-app-text text-xs"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(""); setHighlightedPerm(null); }} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-app-text-muted hover:text-app-text">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex gap-2 w-full md:w-auto shrink-0 overflow-x-auto pb-1 md:pb-0">
          <button onClick={handleGrantAll} disabled={isRootRole} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 text-[9.5px] font-bold rounded-lg transition flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
            <CheckSquare size={10} /><span>Grant All</span>
          </button>
          <button onClick={handleGrantViewOnly} disabled={isRootRole} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 text-[9.5px] font-bold rounded-lg transition flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
            <ShieldAlert size={10} /><span>View Only</span>
          </button>
          <button onClick={handleRevokeAll} disabled={isRootRole} className="px-2.5 py-1.5 bg-red-500/5 hover:bg-red-500/10 text-red-400 border border-red-500/15 text-[9.5px] font-bold rounded-lg transition flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
            <X size={10} /><span>Revoke All</span>
          </button>
        </div>
      </div>

      {/* Permissions Accordions */}
      <div className="space-y-3.5">
        {categories.map((category) => {
          const categoryPerms = filteredPermissions.filter(p => p.category === category);
          const totalInCat = ALL_PERMISSIONS.filter(p => p.category === category).length;
          
          if (categoryPerms.length === 0) return null;

          const isExpanded = activeOpenCategory === category || searchQuery.trim().length > 0;
          const rolePerms = isRootRole ? ALL_PERMISSIONS.map(p => p.code) : editedPermissions;
          const matchedInRole = isRootRole ? totalInCat : ALL_PERMISSIONS.filter(p => p.category === category && rolePerms.includes(p.code)).length;
          const hasAllInModule = isRootRole ? true : ALL_PERMISSIONS.filter(p => p.category === category).map(p => p.code).every(p => rolePerms.includes(p));

          return (
            <div key={category} className="bg-app-card border border-app-border rounded-2xl flex flex-col shadow-xs overflow-hidden">
              
              <div 
                className="p-3.5 flex items-center justify-between gap-3 border-b border-app-border/30 bg-app-card/60 cursor-pointer hover:bg-app-card select-none"
                onClick={() => setActiveOpenCategory(isExpanded ? "" : category)}
              >
                <div className="flex items-center gap-2">
                  <span className="w-1 h-3.5 bg-amber-500 rounded-sm" />
                  <h3 className="text-xs font-bold text-app-text font-display uppercase tracking-wider">{category}</h3>
                  <span className="px-1.5 py-0.2 bg-slate-800 text-[8.5px] rounded-md text-slate-400 font-bold">{matchedInRole} / {totalInCat}</span>
                </div>
                
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleToggleModule(category)} disabled={isRootRole} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border disabled:opacity-40 disabled:cursor-not-allowed ${hasAllInModule ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-app-bg text-app-text-muted border-app-border"}`}>
                    {hasAllInModule ? "Deselect All" : "Select All"}
                  </button>
                  <span className="text-[10px] text-app-text-muted">{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={12} />}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="p-3.5 grid grid-cols-1 md:grid-cols-2 gap-2 bg-app-bg/25 animate-fadeIn">
                  {categoryPerms.map((perm) => {
                    const isEnabled = isRootRole ? true : rolePerms.includes(perm.code);
                    const isHighlighted = highlightedPerm === perm.code || (searchQuery && perm.code.toLowerCase().includes(searchQuery.toLowerCase()));

                    return (
                      <div
                        key={perm.code}
                        id={`perm-code-${perm.code}`}
                        onClick={() => handleTogglePermission(perm.code)}
                        className={`flex items-center justify-between p-2.5 bg-app-card border rounded-xl transition select-none ${
                          isRootRole ? "cursor-not-allowed opacity-85 bg-slate-100/5" : "cursor-pointer"
                        } ${
                          isHighlighted 
                            ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500 shadow" 
                            : "border-app-border/40 hover:border-app-border/80"
                        }`}
                      >
                        <div className="flex-1 pr-3">
                          <code className={`text-[10px] font-mono font-bold block ${isHighlighted ? "text-amber-400" : "text-amber-500 dark:text-amber-400"}`}>
                            {perm.code}
                          </code>
                          <p className="text-[9.5px] text-app-text-muted mt-0.5 leading-normal font-medium">{perm.description}</p>
                        </div>
                        <button className="shrink-0 text-app-text-muted transition-colors" disabled={isRootRole}>
                          {isRootRole ? (
                            <Lock size={16} className="text-amber-500/70 mr-1" />
                          ) : isEnabled ? (
                            <ToggleRight size={22} className="text-amber-500" />
                          ) : (
                            <ToggleLeft size={22} />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Static Premium Save Bar at Bottom */}
      <div className="bg-app-card border border-app-border p-4 rounded-2xl flex items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-2">
          <Info size={14} className="text-amber-500 shrink-0" />
          <span className="text-[10px] text-app-text-muted leading-tight font-medium">
            Remember to save changes. Baseline default roles can be reset at any time.
          </span>
        </div>
        
        <div className="flex gap-2">
          <button onClick={handleReset} disabled={isRootRole} className="px-3 py-2 bg-slate-800 border border-slate-700 text-[10px] font-black text-slate-300 rounded-xl transition flex items-center gap-1.5 uppercase hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
            <RefreshCw size={11} /><span>Reset Default</span>
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-amber-500 text-slate-950 text-[10px] font-black rounded-xl transition flex items-center gap-1.5 shadow-md uppercase hover:bg-amber-600">
            <ShieldCheck size={12} /><span>Save Settings</span>
          </button>
        </div>
      </div>

    </div>
  );
}