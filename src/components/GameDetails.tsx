import React, { useCallback, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Game, GameMedia } from '../types/game';
import { findGameByName } from '../libraryContext';
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
  Gamepad2,
  ChevronDown,
} from 'lucide-react';
import { MediaViewerModal } from './MediaViewerModal';
import { MediaPreview } from './MediaPreview';
import { ShimmerImage } from '../directives/ShimmerImage';
import { revealDelay, revealTransition } from '../motion';

const MEDIA_PAGE_SIZE = 4;

type MediaTab = 'all' | 'screenshot' | 'video' | 'backup';

interface GameDetailsProps {
  game: Game;
}

type MediaViewerLocationState = {
  mediaViewer?: boolean;
};

export const GameDetails: React.FC<GameDetailsProps> = ({ game }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ gameName: string }>();
  const [searchParams] = useSearchParams();
  const [mediaList, setMediaList] = useState<GameMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MediaTab>('all');
  const [visibleImagesCount, setVisibleImagesCount] = useState(MEDIA_PAGE_SIZE);
  const [visibleVideosCount, setVisibleVideosCount] = useState(MEDIA_PAGE_SIZE);
  const [visibleBackupsCount, setVisibleBackupsCount] = useState(MEDIA_PAGE_SIZE);

  const isActiveRoute = Boolean(findGameByName([game], params.gameName));
  const mediaId = isActiveRoute ? searchParams.get('media') : null;
  const selectedMedia = mediaId
    ? mediaList.find((item) => item.id === mediaId) ?? null
    : null;

  const openMedia = useCallback(
    (item: GameMedia) => {
      const next = new URLSearchParams(searchParams);
      next.set('media', item.id);
      const search = next.toString();
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        {
          replace: searchParams.has('media'),
          preventScrollReset: true,
          state: { mediaViewer: true } satisfies MediaViewerLocationState,
        }
      );
    },
    [location.pathname, navigate, searchParams]
  );

  const closeMedia = useCallback(() => {
    if (!searchParams.has('media')) return;
    const state = location.state as MediaViewerLocationState | null;
    if (state?.mediaViewer && window.history.length > 1) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete('media');
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true, preventScrollReset: true }
    );
  }, [location.pathname, location.state, navigate, searchParams]);

  // Branding assets from the public media bucket
  const [bannerUrl, setBannerUrl] = useState<string | null>(() =>
    localAssetService.getGameBanner(game)
  );
  const [coverUrl, setCoverUrl] = useState<string | null>(() =>
    localAssetService.getGameCover(game)
  );
  const [iconUrl, setIconUrl] = useState<string | null>(() =>
    localAssetService.getGameIcon(game)
  );

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

  const visibleImages = imagesList.slice(0, visibleImagesCount);
  const visibleVideos = videosList.slice(0, visibleVideosCount);
  const visibleBackups = backupsList.slice(0, visibleBackupsCount);

  const selectTab = (tab: MediaTab) => {
    setActiveTab(tab);
    setVisibleImagesCount(MEDIA_PAGE_SIZE);
    setVisibleVideosCount(MEDIA_PAGE_SIZE);
    setVisibleBackupsCount(MEDIA_PAGE_SIZE);
  };

  return (
    <div className="relative pb-12">
      {/* Background banner from the media bucket */}
      <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 h-[280px] sm:h-[380px] lg:h-[420px] overflow-hidden bg-zinc-950">
        {bannerUrl ? (
          <ShimmerImage
            src={bannerUrl}
            alt=""
            wrapperClassName="absolute inset-0"
            className="absolute inset-0 h-full w-full object-cover object-[center_20%] brightness-[0.7] contrast-105"
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#121212]/80 via-[#121212]/30 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6">
          <div className="flex items-end justify-between gap-3 sm:gap-6">
            <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
              <div className="w-10 h-10 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-lg sm:rounded-xl bg-zinc-900/80 border border-zinc-700/60 p-1 shadow-lg shrink-0 overflow-hidden">
                {iconUrl ? (
                  <ShimmerImage
                    src={iconUrl}
                    alt=""
                    className="w-full h-full object-contain"
                    onError={() => setIconUrl(null)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Gamepad2 className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-500" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-2xl lg:text-3xl font-bold text-white leading-tight line-clamp-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                  {game.name}
                </h1>
                {(game.releaseYear || game.steamAppId) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-zinc-300">
                    {game.releaseYear && (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        {game.releaseYear}
                      </span>
                    )}
                    {game.steamAppId && (
                      <a
                        href={`https://store.steampowered.com/app/${game.steamAppId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                      >
                        <span>Steam Store</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {coverUrl && (
              <div className="w-[72px] sm:w-[110px] md:w-[132px] lg:w-[150px] aspect-[5/7] rounded-md sm:rounded-lg overflow-hidden border border-zinc-700/80 shadow-2xl shrink-0 bg-zinc-950">
                <ShimmerImage
                  src={coverUrl}
                  alt={`Capa de ${game.name}`}
                  className="w-full h-full object-cover"
                  onError={() => setCoverUrl(null)}
                />
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Media Filter Tabs */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 mt-6 min-w-0 overflow-x-clip bg-[#121212]/92 backdrop-blur-md border-b border-zinc-800/80">
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 lg:px-8 py-3">
          <button
            onClick={() => selectTab('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer ${
              activeTab === 'all'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            Todas as Mídias ({mediaList.length})
          </button>
          <button
            onClick={() => selectTab('screenshot')}
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
            onClick={() => selectTab('video')}
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
              onClick={() => selectTab('backup')}
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
            {showImagesSection && (
              <MediaSection
                title="Imagens"
                icon={<ImageIcon className="w-4 h-4 text-purple-400" />}
                items={visibleImages}
                onOpen={openMedia}
                onLoadMore={
                  visibleImages.length < imagesList.length
                    ? () => setVisibleImagesCount((count) => count + MEDIA_PAGE_SIZE)
                    : undefined
                }
                remaining={imagesList.length - visibleImages.length}
              />
            )}

            {showVideosSection && (
              <MediaSection
                title="Vídeos"
                icon={<Film className="w-4 h-4 text-rose-400" />}
                items={visibleVideos}
                onOpen={openMedia}
                onLoadMore={
                  visibleVideos.length < videosList.length
                    ? () => setVisibleVideosCount((count) => count + MEDIA_PAGE_SIZE)
                    : undefined
                }
                remaining={videosList.length - visibleVideos.length}
              />
            )}

            {showBackupsSection && (
              <MediaSection
                title="Saves & Backups"
                icon={<Archive className="w-4 h-4 text-indigo-400" />}
                items={visibleBackups}
                onOpen={openMedia}
                onLoadMore={
                  visibleBackups.length < backupsList.length
                    ? () => setVisibleBackupsCount((count) => count + MEDIA_PAGE_SIZE)
                    : undefined
                }
                remaining={backupsList.length - visibleBackups.length}
              />
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {selectedMedia && (
          <MediaViewerModal
            key={selectedMedia.id}
            media={selectedMedia}
            onClose={closeMedia}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

interface MediaSectionProps {
  title: string;
  icon: React.ReactNode;
  items: GameMedia[];
  remaining: number;
  onOpen: (item: GameMedia) => void;
  onLoadMore?: () => void;
}

const MediaSection: React.FC<MediaSectionProps> = ({
  title,
  icon,
  items,
  remaining,
  onOpen,
  onLoadMore,
}) => (
  <section>
    <div className="flex items-center mb-4 px-1 gap-2">
      {icon}
      <h2 className="text-sm font-bold tracking-wider uppercase text-zinc-200 font-sans">
        {title}
      </h2>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {items.map((item, index) => (
        <MediaTile key={item.id} item={item} index={index} onOpen={onOpen} />
      ))}
    </div>

    {onLoadMore && remaining > 0 && (
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={onLoadMore}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-200 hover:text-white hover:border-zinc-600 cursor-pointer transition"
        >
          Ver mais {Math.min(MEDIA_PAGE_SIZE, remaining)}
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    )}
  </section>
);

const MediaTile: React.FC<{
  item: GameMedia;
  index: number;
  onOpen: (item: GameMedia) => void;
}> = ({ item, index, onOpen }) => {
  const revealProps = {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.15 },
    transition: { ...revealTransition, delay: revealDelay(index, 8) },
  } as const;

  if (item.type === 'backup') {
    return (
      <motion.button
        type="button"
        onClick={() => onOpen(item)}
        className="group relative aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 hover:border-purple-500/50 cursor-pointer shadow-md transition duration-300 flex flex-col items-center justify-center p-3 text-center"
        aria-label="Abrir arquivo"
        {...revealProps}
      >
        <Archive className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition" />
      </motion.button>
    );
  }

  const isVideo = item.type === 'video';

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={isVideo ? `Reproduzir ${item.name}` : 'Abrir imagem em tamanho real'}
      className="group relative aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 hover:border-purple-500/60 cursor-pointer shadow-md hover:shadow-xl hover:shadow-purple-500/10 transition duration-300 text-left"
      {...revealProps}
    >
      <MediaPreview
        kind="image"
        src={isVideo ? item.thumbnailUrl || '' : item.url || item.thumbnailUrl || ''}
        className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${isVideo ? 'brightness-90 group-hover:brightness-100' : ''}`}
      />
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-11 h-11 rounded-full bg-black/60 border border-white/20 backdrop-blur-sm text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-purple-600/90 group-hover:border-purple-400 transition duration-300">
            <Play className="w-4 h-4 fill-white ml-0.5" />
          </div>
        </div>
      )}
    </motion.button>
  );
};
