import React from 'react';
import { Link } from 'react-router-dom';
import { Gamepad2, Search, RefreshCw } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefreshLocal: () => void;
  isSyncing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  onSearchChange,
  onRefreshLocal,
  isSyncing,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-[#121212]/80 backdrop-blur-md border-b border-zinc-800/60 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Brand Logo */}
        <Link
          to="/"
          className="flex items-center gap-2 text-left shrink-0 cursor-pointer group"
          title="Início"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center p-0.5 shadow-md shadow-purple-600/20 group-hover:scale-105 transition">
            <div className="w-full h-full bg-[#18181b] rounded-[6px] flex items-center justify-center">
              <Gamepad2 className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <span className="font-bold tracking-wider text-xs sm:text-base text-white uppercase font-sans hidden sm:inline">
            Biblioteca de Jogos
          </span>
        </Link>

        {/* Center: Search Bar */}
        <div className="flex-1 min-w-0 max-w-md mx-2 sm:mx-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Pesquisar..."
              className="w-full pl-9 pr-3 py-1.5 sm:py-2 bg-zinc-900/90 hover:bg-zinc-900 focus:bg-zinc-900 text-zinc-100 placeholder-zinc-500 rounded-full text-xs sm:text-sm border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/50 outline-none transition"
            />
          </div>
        </div>

        {/* Right: Actions, Refresh, Install */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Refresh Local Library Button */}
          <button
            onClick={onRefreshLocal}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/50 transition cursor-pointer"
            title="Recarregar biblioteca (limpa o cache e busca o catálogo no worker)"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-purple-400 ${isSyncing ? 'animate-spin text-purple-300' : ''}`}
            />
            <span className="hidden md:inline">
              {isSyncing ? 'Atualizando...' : 'Atualizar'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
