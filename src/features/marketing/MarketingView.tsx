// Marketing & advertising workspace: campaigns, their creatives, the media library (with Canva),
// website placements and performance, each on its own screen beside a sidebar (a scrolling row
// on phones), like the Website workspace. Opening it needs marketing.view; every change is checked
// again by the database (marketing.manage, migration 20261207001).
import React, { useState } from 'react';
import { BarChart3, Image, LayoutDashboard, LayoutTemplate, Megaphone } from 'lucide-react';
import { useBusinessStore } from '../../stores/businessStore';
import DashboardScreen from './DashboardScreen';
import CampaignsScreen from './CampaignsScreen';
import CampaignEditor from './CampaignEditor';
import StudioScreen from './StudioScreen';
import PlacementsScreen from './PlacementsScreen';
import PerformanceScreen from './PerformanceScreen';

export type MarketingScreenId = 'dashboard' | 'campaigns' | 'studio' | 'placements' | 'performance';

const SCREENS: { id: MarketingScreenId; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { id: 'studio', label: 'Creative studio', icon: Image },
  { id: 'placements', label: 'Placements', icon: LayoutTemplate },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
];

export interface MarketingNav {
  go: (screen: MarketingScreenId) => void;
  /** Opens a campaign; 'new' starts one (optionally of a type, e.g. 'black_friday'). */
  openCampaign: (id: string | 'new', type?: string) => void;
}

export default function MarketingView() {
  const businessId = useBusinessStore((s) => s.activeBusinessId);
  const [screen, setScreen] = useState<MarketingScreenId>('dashboard');
  const [campaign, setCampaign] = useState<{ id: string | 'new'; type?: string } | null>(null);

  const nav: MarketingNav = {
    go: (s) => { setCampaign(null); setScreen(s); },
    openCampaign: (id, type) => { setScreen('campaigns'); setCampaign({ id, type }); },
  };

  const body = (() => {
    if (!businessId) return <p className="text-sm text-app-text-muted">Choose a business first.</p>;
    if (screen === 'campaigns' && campaign) {
      return (
        <CampaignEditor
          key={`${businessId}:${campaign.id}`}
          businessId={businessId}
          campaignId={campaign.id}
          newType={campaign.type}
          onClose={() => setCampaign(null)}
          onOpen={(id) => setCampaign({ id })}
        />
      );
    }
    switch (screen) {
      case 'dashboard': return <DashboardScreen key={businessId} businessId={businessId} nav={nav} />;
      case 'campaigns': return <CampaignsScreen key={businessId} businessId={businessId} nav={nav} />;
      case 'studio': return <StudioScreen key={businessId} businessId={businessId} />;
      case 'placements': return <PlacementsScreen key={businessId} businessId={businessId} />;
      case 'performance': return <PerformanceScreen key={businessId} businessId={businessId} nav={nav} />;
    }
  })();

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <nav aria-label="Marketing" className="shrink-0 border-b border-app-border lg:w-56 lg:border-b-0 lg:border-r">
        <h1 className="hidden px-4 pb-2 pt-5 font-display text-xl font-bold text-app-text lg:block">Marketing</h1>
        <ul className="no-scrollbar flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
          {SCREENS.map((s) => {
            const on = s.id === screen;
            const Icon = s.icon;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => nav.go(s.id)}
                  className={`flex min-h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition ${on ? 'bg-brand-500/15 text-app-text' : 'text-app-text-muted hover:bg-app-bg hover:text-app-text'}`}
                >
                  <Icon size={16} className={on ? 'text-brand-500' : ''} /> {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 pb-nav sm:p-6">{body}</div>
    </div>
  );
}
