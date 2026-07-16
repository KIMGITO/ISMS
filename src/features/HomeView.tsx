import React from "react";
import {  TrendingUp } from "lucide-react";
import BusinessDashboard from "../components/BusinessDashboard";

export default function HomeView() {
  return (
    <div id="home-dashboard-view" className="h-full overflow-y-auto bg-app-bg text-app-text font-sans">
      {/* Top Banner Accent */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-app-border/40 p-5 shrink-0 z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black font-display text-app-text tracking-tight flex items-center gap-2">
            <TrendingUp size={22} className="text-amber-500" />
            Dairy Command Center
          </h1>
          <p className="text-xs text-app-text-muted mt-1 max-w-xl leading-normal">
            Real-time analytics portal. Monitor system sales, customer metrics, cash versus digital flow, sister branch operations, and overall business health metrics.
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2.5 bg-app-card border border-app-border px-3.5 py-1.5 rounded-2xl shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 " />
          <span className="text-[10px] font-black uppercase tracking-wider text-app-text-muted">Live Feed Active</span>
        </div>
      </div>

      {/* Main Dashboard Render */}
      <div className="p-4 pb-24">
        <BusinessDashboard />
      </div>
    </div>
  );
}
