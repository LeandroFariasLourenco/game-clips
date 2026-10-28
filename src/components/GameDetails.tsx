import React, { useState, useEffect } from 'react';
import { Game, GameMedia } from '../types/game';
import { localAssetService } from '../services/driveAssetService';
import { localLibraryService } from '../services/driveService';
import { collectGameMediaCacheUrls, warmMediaCache } from '../services/mediaCache';
import {
  Play,
  Image as ImageIcon,
  Film,
  Archive,
  ExternalLink,
  HardDrive,
  Calendar,
  Layers,
  Gamepad2,
} from 'lucide-react';
import { MediaViewerModal } from './MediaViewerModal';
import { MediaPreview } from './MediaPreview';

interface GameDetailsProps {
  game: Game;
}

export const GameDetails: React.FC<GameDetailsProps> = ({ game }) => {
  const [mediaList, setMediaList] = useState<GameMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'screenshot' | 'video' | 'backup'>('all');
  const [selectedMedia, setSelectedMedia] = useState<GameMedia | null>(null);

  // Branding assets from the public media bucket
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    const banner = localAssetService.getGameBanner(game);
    const cover = localAssetService.getGameCover(game);
    const icon = localAssetService.getGameIcon(game);
    setBannerUrl(banner);
    setCoverUrl(cover);
    setIconUrl(icon);
  }, [game.id]);

  useEffect(() => {
    let cancelled = false;

    const loadMedia = async () => {
      setLoading(true);
      try {
        const [imagesResult, videosResult] = await Promise.allSettled([
          localLibraryService.listGameImages(game),
          localLibraryService.listGameVideos(game),
        ]);
        if (imagesResult.status === 'rejected') {
          console.error('Falha ao listar imagens do jogo:', imagesResult.reason);
        }
        if (videosResult.status === 'rejected') {
          console.error('Falha ao listar vídeos do jogo:', videosResult.reason);
        }
        const images = imagesResult.status === 'fulfilled' ? imagesResult.value : [];
        const videos = videosResult.status === 'fulfilled' ? videosResult.value : [];
        const listed = [...images, ...videos];
        if (!cancelled) {
          setMediaList(listed);
          void warmMediaCache(collectGameMediaCacheUrls(listed));
        }
      } catch (error) {
        console.error('Falha ao listar mídias do jogo:', error);
        if (!cancelled) setMediaList([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadMedia();
    return () => {
      cancelled = true;
    };
  }, [game.id, game.name, game.subfolderName]);

  const imagesList = mediaList.filter((m) => m.type === 'screenshot' || m.type === 'artwork');
  const videosList = mediaList.filter((m) => m.type === 'video');
  const backupsList = mediaList.filter((m) => m.type === 'backup');

  const showImagesSection =
    (activeTab === 'all' || activeTab === 'screenshot') && imagesList.length > 0;
  const showVideosSection =
    (activeTab === 'all' || activeTab === 'video') && videosList.length > 0;
  const showBackupsSection =
    (activeTab === 'all' || activeTab === 'backup') && backupsList.length > 0;

  const hasVisibleMedia = showImagesSection || showVideosSection || showBackupsSection;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] pb-12 animate-fadeIn">
      {/* Background banner from the media bucket */}
      <div className="relative w-full h-[280px] sm:h-[380px] lg:h-[420px] overflow-hidden -mx-4 sm:-mx-6 lg:-mx-8 bg-zinc-950">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt=""
            className="w-full h-full object-cover brightness-[0.7] contrast-105 scale-100"
            loading="eager"
            decoding="async"
            onError={() => {
              if (coverUrl && bannerUrl !== coverUrl) setBannerUrl(coverUrl);
              else setBannerUrl(null);
            }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-950/30 via-zinc-950 to-zinc-900 flex items-center justify-center">
            <Gamepad2 className="w-20 h-20 text-zinc-800 opacity-30" />
          </div>
        )}

        {/* Cinematic Vignette Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#121212]/90 via-[#121212]/40 to-transparent" />

        {(iconUrl || game.releaseYear || game.genre || game.steamAppId) && (
          <div className="absolute bottom-6 left-4 sm:left-8 right-4 sm:right-8 z-10 max-w-4xl">
            {(game.releaseYear || game.genre || game.steamAppId) && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300 mb-2">
                {game.releaseYear && (
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Calendar className="w-3.5 h-3.5" />
                    {game.releaseYear}
                  </span>
                )}

                {game.genre && (
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Layers className="w-3.5 h-3.5" />
                    {game.genre}
                  </span>
                )}

                {game.steamAppId && (
                  <a
                    href={`https://store.steampowered.com/app/${game.steamAppId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 ml-auto"
                  >
                    <span>Steam Store</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl object-contain bg-zinc-900/80 border border-zinc-700/60 p-1 shadow-lg shrink-0"
                onError={() => setIconUrl(null)}
              />
            )}
          </div>
        )}
      </div>

      {/* Media Filter Tabs */}
      <div className="mt-8 flex flex-wrap items-center gap-4 border-b border-zinc-800/80 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer ${
              activeTab === 'all'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            Todas as Mídias ({mediaList.length})
          </button>
          <button
            onClick={() => setActiveTab('screenshot')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'screenshot'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Imagens ({imagesList.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'video'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Vídeos ({videosList.length})</span>
          </button>
          {backupsList.length > 0 && (
            <button
              onClick={() => setActiveTab('backup')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'backup'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Saves & Backups ({backupsList.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Media Sections (Imagens & Vídeos) or Empty State */}
      <div className="mt-6 space-y-10">
        {loading ? (
          <div className="py-20 text-center">
            <div className="inline-block w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-zinc-400">Buscando mídias do jogo no bucket...</p>
          </div>
        ) : !hasVisibleMedia ? (
          <div className="py-16 text-center max-w-md mx-auto border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/30 p-8">
            <div className="w-12 h-12 mx-auto rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500 mb-3">
              <HardDrive className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-zinc-200">Nenhuma mídia encontrada</h3>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
              Ainda não há screenshots ou clips listados para este jogo no bucket.
            </p>
          </div>
        ) : (
          <>
            {/* Seção de Imagens */}
            {showImagesSection && (
              <section>
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-purple-400" />
                    <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-200 font-sans">
                      Imagens
                    </h2>
                  </div>
                  <span className="text-xs text-zinc-500 font-mono">
                    {imagesList.length} {imagesList.length === 1 ? 'imagem' : 'imagens'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {imagesList.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedMedia(item)}
                      className="group relative aspect-video rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-purple-500/60 cursor-pointer shadow-md hover:shadow-xl hover:shadow-purple-500/10 transition duration-300"
                    >
                      <MediaPreview
                        kind="image"
                        src={item.url || item.thumbnailUrl || ''}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Seção de Vídeos */}
            {showVideosSection && (
              <section>
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-rose-400" />
                    <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-200 font-sans">
                      Vídeos
                    </h2>
                  </div>
                  <span className="text-xs text-zinc-500 font-mono">
                    {videosList.length} {videosList.length === 1 ? 'vídeo' : 'vídeos'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {videosList.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedMedia(item)}
                      className="group relative aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 hover:border-purple-500/60 cursor-pointer shadow-md hover:shadow-xl hover:shadow-purple-500/10 transition duration-300"
                    >
                      <MediaPreview
                        kind="image"
                        src={item.thumbnailUrl || ''}
                        className="w-full h-full object-cover brightness-90 group-hover:brightness-100 group-hover:scale-105 transition duration-500"
                      />

                      {/* Play Button Badge Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-11 h-11 rounded-full bg-black/60 border border-white/20 backdrop-blur-sm text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-purple-600/90 group-hover:border-purple-400 transition duration-300">
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Seção de Saves & Backups */}
            {showBackupsSection && (
              <section>
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    <Archive className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-200 font-sans">
                      Saves & Backups
                    </h2>
                  </div>
                  <span className="text-xs text-zinc-500 font-mono">
                    {backupsList.length} {backupsList.length === 1 ? 'arquivo' : 'arquivos'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {backupsList.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedMedia(item)}
                      className="group relative aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 hover:border-purple-500/50 cursor-pointer shadow-md transition duration-300 flex flex-col items-center justify-center p-3 text-center"
                      aria-label="Abrir arquivo"
                    >
                      <Archive className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Media Viewer Modal */}
      {selectedMedia && (
        <MediaViewerModal
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
        />
      )}
    </div>
  );
};
