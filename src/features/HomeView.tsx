import React from "react";
import {  TrendingUp } from "lucide-react";
import BusinessDashboard from "../components/BusinessDashboard";
import OnlineStoreAlerts from "../components/OnlineStoreAlerts";

export default function HomeView() {
  return (
    <div id="home-dashboard-view" className="h-full overflow-y-auto bg-app-bg text-app-text font-sans">
      

      {/* Main Dashboard Render */}
      <div className="p-4 pb-24">
        <OnlineStoreAlerts />
        <BusinessDashboard />
      </div>
    </div>
  );
}
