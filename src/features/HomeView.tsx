import React from "react";
import HomeDashboard from "./home/HomeDashboard";
import OnlineStoreAlerts from "../components/OnlineStoreAlerts";

export default function HomeView() {
  return (
    <div id="home-dashboard-view" className="h-full overflow-y-auto bg-app-bg text-app-text font-sans">
      <div className="px-4 pt-5 pb-nav sm:px-6 lg:px-8">
        <OnlineStoreAlerts />
        <HomeDashboard />
      </div>
    </div>
  );
}
