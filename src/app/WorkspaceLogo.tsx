import React, { useState } from 'react';
import { Building } from 'lucide-react';

/** The business logo in the sidebar, or a building icon when there is none or it fails to load. */
export const WorkspaceLogo: React.FC<{ logoUrl?: string; name: string }> = ({
  logoUrl,
  name,
}) => {
  const [error, setError] = useState(false);

  if (error || !logoUrl || logoUrl.trim() === '') {
    return (
      <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-750 shrink-0 text-amber-500">
        <Building size={18} />
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt={name}
      onError={() => setError(true)}
      className="w-10 h-10 rounded-xl object-cover border border-slate-850 shrink-0"
      referrerPolicy="no-referrer"
    />
  );
};
