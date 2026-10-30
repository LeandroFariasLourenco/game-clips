import React from 'react';
import { NavLink } from 'react-router-dom';
import { Clapperboard, Home } from 'lucide-react';
import { REELS_PATH } from '../libraryContext';

const tabs = [
  { to: '/', end: true, label: 'Home', Icon: Home },
  { to: REELS_PATH, end: true, label: 'Reels', Icon: Clapperboard },
] as const;

export const AppTabBar: React.FC = () => {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navegação principal"
    >
      <div className="mx-auto flex h-12 max-w-md items-stretch">
        {tabs.map(({ to, end, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            preventScrollReset
            aria-label={label}
            className={({ isActive }) =>
              `flex flex-1 items-center justify-center transition-colors ${
                isActive ? 'text-white' : 'text-zinc-500'
              }`
            }
          >
            {({ isActive }) => (
              <Icon
                className="h-[26px] w-[26px]"
                strokeWidth={isActive ? 2.35 : 1.75}
                fill={isActive ? 'currentColor' : 'none'}
              />
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
