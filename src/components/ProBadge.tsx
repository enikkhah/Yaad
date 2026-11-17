import React from 'react';
import { Lock } from 'lucide-react';

interface ProBadgeProps {
  locked?: boolean;
  className?: string;
}

export const ProBadge: React.FC<ProBadgeProps> = ({ locked = true, className = '' }) => {
  if (!locked) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-black leading-none shrink-0 ${className}`}
    >
      <Lock className="w-2.5 h-2.5 shrink-0" />
      <span>Pro</span>
    </span>
  );
};
