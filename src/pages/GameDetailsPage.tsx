import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { GameDetails } from '../components/GameDetails';
import { useFrozenRoute } from '../components/CachedOutlet';
import { useLibrary } from '../libraryContext';
import { Gamepad2 } from 'lucide-react';

export const GameDetailsPage: React.FC = () => {
  const { games, isSyncing } = useLibrary();
  const frozen = useFrozenRoute();
  const { gameId } = useParams<{ gameId: string }>();

  const decodedId = gameId ? decodeURIComponent(gameId) : '';
  const selectedGame =
    (frozen?.cacheKey
      ? games.find((game) => game.name === frozen.cacheKey)
      : undefined) ??
    frozen?.game ??
    games.find((game) => game.id === decodedId);

  if (isSyncing && !selectedGame) {
    return (
      <div className="py-24 text-center">
        <div className="inline-block w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs text-zinc-400">Carregando informações do jogo...</p>
      </div>
    );
  }

  if (!selectedGame) {
    return (
      <div className="py-20 text-center max-w-md mx-auto">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 mb-4">
          <Gamepad2 className="w-8 h-8" />
        </div>
        <h2 className="text-base font-bold text-zinc-200">Jogo não encontrado</h2>
        <p className="text-xs text-zinc-400 mt-2">
          Não foi possível localizar o jogo solicitado na biblioteca.
        </p>
        <Link
          to="/"
          className="inline-flex mt-5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition"
        >
          Voltar à biblioteca
        </Link>
      </div>
    );
  }

  return <GameDetails game={frozen?.game ?? selectedGame} />;
};
