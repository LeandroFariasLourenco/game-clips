import React from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Search } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { useLibrary } from '../libraryContext';
import { pageTransition } from '../motion';

export const LibraryToolbar: React.FC = () => {
  const { searchQuery, onSearchChange, onRefreshLocal, isSyncing } = useLibrary();

  return (
    <motion.div
      className="flex items-center gap-2 sm:gap-2.5 mb-3 sm:mb-5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...pageTransition, delay: 0.05 }}
    >
      <div className="relative flex-1 min-w-0">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
          <Search className="w-4 h-4" />
        </div>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Pesquisar jogos..."
          className="w-full h-10 pl-10 pr-4 bg-zinc-900/90 hover:bg-zinc-900 focus:bg-zinc-900 text-zinc-100 placeholder-zinc-500 rounded-xl text-sm border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/50 outline-none transition"
          aria-label="Pesquisar jogos"
        />
      </div>

      <button
        onClick={onRefreshLocal}
        disabled={isSyncing}
        className="h-10 shrink-0 flex items-center gap-1.5 px-3.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 transition cursor-pointer disabled:opacity-60"
        title="Recarregar biblioteca (limpa o cache e busca o catálogo no worker)"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 text-purple-400 ${isSyncing ? 'animate-spin text-purple-300' : ''}`}
        />
        <span className="hidden sm:inline">
          {isSyncing ? 'Atualizando...' : 'Atualizar'}
        </span>
      </button>

      <PWAInstallButton />
    </motion.div>
  );
};
