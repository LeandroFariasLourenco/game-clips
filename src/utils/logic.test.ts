import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyUserAccess, DEFAULT_OWNER_EMAIL } from './accessControl';
import { serializeGamesToMasterJson, parseMasterJsonToGames } from './storageFormat';
import { formatPlaytime } from './steamArt';
import { Game } from '../types/game';
import {
  DEFAULT_MEDIA_BUCKET_URL,
  DEFAULT_MEDIA_WORKER_URL,
  GAME_BRANDING_ASSETS,
  buildMediaFileUrl,
  gameImagesUrl,
  gameMetadataUrl,
  gameVideosUrl,
  gamesCatalogUrl,
  matchBrandingAsset,
  resolveMediaBaseUrl,
  resolveMediaWorkerUrl,
  sanitizeVideoSrc,
  videoUrlBesideThumb,
} from '../config/mediaConfig';
import { isMediaAssetUrl } from '../services/mediaAssetUrl';
import { collectGameMediaCacheUrls } from '../services/mediaCache';
import {
  HOME_CACHE_KEY,
  findGameByName,
  gameDetailsCacheKey,
  gameDetailsPath,
  resolveRouteCacheKey,
} from '../libraryContext';
import { localAssetService } from '../services/driveAssetService';
import { mapListedImagesToMedia, mapListedVideosToMedia } from '../services/driveService';
import { parseMediaCapturedAt } from './mediaSort';
import {
  FEATURED_COUNT,
  FEATURED_ROTATION_MS,
  FEATURED_STORAGE_KEY,
  FeaturedItem,
  createRotation,
  formatRemaining,
  getOrCreateRotation,
  isBrandingAsset,
  isRotationValid,
  pickFeaturedItems,
  remainingMs,
} from './featuredRotation';
import {
  featuredMediaRandom,
  parseGameMetadata,
  pickGameFeaturedMedia,
  zipFeaturedHighlights,
} from './featuredMedia';
import {
  DAILY_FEATURED_COUNT,
  DAILY_FEATURED_STORAGE_KEY,
  getOrCreateDailyFeaturedGames,
  gamesWithoutFeatured,
  msUntilNextDailyFeatured,
  nextDailyFeaturedAt,
} from './dailyFeaturedGames';

test('verifyUserAccess allows authorized owner email and rejects others', () => {
  const allowed = verifyUserAccess(DEFAULT_OWNER_EMAIL);
  assert.equal(allowed.isAuthorized, true);
  assert.equal(allowed.userEmail, DEFAULT_OWNER_EMAIL.toLowerCase());

  const caseInsensitive = verifyUserAccess('  FELEOLIVE2010@GMAIL.COM ');
  assert.equal(caseInsensitive.isAuthorized, true);

  const denied = verifyUserAccess('intruder@example.com');
  assert.equal(denied.isAuthorized, false);
  assert.match(denied.errorMessage || '', /Acesso Negado/);

  const empty = verifyUserAccess('');
  assert.equal(empty.isAuthorized, false);
});

test('serializeGamesToMasterJson produces Flat File payload without media paths', () => {
  const games: Game[] = [
    {
      id: 'steam-730',
      name: 'Counter-Strike 2',
      steamAppId: '730',
      playTimeMinutes: 14500,
      subfolderName: 'Counter-Strike 2',
    },
  ];

  const serialized = serializeGamesToMasterJson(games);
  assert.match(serialized, /"subfolderName": "Counter-Strike 2"/);
  assert.equal(serialized.includes('mediaPaths'), false);
  assert.equal(serialized.includes('screenshots'), false);

  const restored = parseMasterJsonToGames(serialized);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, 'Counter-Strike 2');
  assert.equal(restored[0].steamAppId, '730');
  assert.equal(restored[0].playTimeMinutes, 14500);

  const bucketManifest = parseMasterJsonToGames('[{"name":"FIFA 15"},{"name":"Halo: Reach"}]');
  assert.equal(bucketManifest.length, 2);
  assert.equal(bucketManifest[0].name, 'FIFA 15');
  assert.equal(bucketManifest[0].subfolderName, 'FIFA 15');
  assert.equal(bucketManifest[1].subfolderName, 'Halo Reach');

  const workerCatalog = parseMasterJsonToGames(
    JSON.stringify([
      {
        name: 'Cyberpunk 2077',
        cover: `${DEFAULT_MEDIA_WORKER_URL}/Cyberpunk%202077/cover.jpg`,
      },
    ])
  );
  assert.equal(workerCatalog.length, 1);
  assert.equal(workerCatalog[0].name, 'Cyberpunk 2077');
  assert.equal(workerCatalog[0].cover, `${DEFAULT_MEDIA_WORKER_URL}/Cyberpunk%202077/cover.jpg`);
  assert.equal(localAssetService.getGameCover(workerCatalog[0]), workerCatalog[0].cover);
});

test('formatPlaytime formats durations correctly and verifies asset naming conventions', () => {
  assert.equal(formatPlaytime(0), 'Nunca jogado');
  assert.equal(formatPlaytime(45), '45 min');
  assert.equal(formatPlaytime(120), '2 h');
  assert.equal(formatPlaytime(150), '2.5 h');

  assert.equal(GAME_BRANDING_ASSETS.cover, 'cover.jpg');
  assert.equal(GAME_BRANDING_ASSETS.banner, 'banner.jpg');
  assert.equal(GAME_BRANDING_ASSETS.icon, 'icon.png');
  assert.equal(matchBrandingAsset('cover.jpg'), 'cover');
  assert.equal(matchBrandingAsset('banner.jpg'), 'banner');
  assert.equal(matchBrandingAsset('icon.png'), 'icon');
  assert.equal(matchBrandingAsset('cover.png'), null);
  assert.equal(matchBrandingAsset('icon.ico'), null);
  assert.equal(matchBrandingAsset('hero.jpg'), null);
});

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
    store,
  };
}

function sampleCandidates(): FeaturedItem[] {
  return Array.from({ length: 12 }, (_, index) => ({
    gameId: `game-${index}`,
    gameName: `Game ${index}`,
    type: index % 3 === 0 ? 'video' : 'image',
    url: `/media/game-${index}/clip-${index}.jpg`,
  }));
}

test('featured rotation expires after 7 days and is reused until then', () => {
  const now = 1_700_000_000_000;
  const rotation = createRotation(sampleCandidates().slice(0, 8), now);
  assert.equal(rotation.items.length, 8);
  assert.equal(rotation.expiresAt, now + FEATURED_ROTATION_MS);
  assert.equal(isRotationValid(rotation, now + 1000), true);
  assert.equal(isRotationValid(rotation, now + FEATURED_ROTATION_MS), false);
  assert.equal(remainingMs(rotation, now + FEATURED_ROTATION_MS - 1000), 1000);
});

test('pickFeaturedItems prefers one media per game and respects the count', () => {
  const random = () => 0;
  const picked = pickFeaturedItems(sampleCandidates(), FEATURED_COUNT, random);
  assert.equal(picked.length, FEATURED_COUNT);
  const gameIds = picked.map((item) => item.gameId);
  assert.equal(new Set(gameIds).size, FEATURED_COUNT);
});

test('getOrCreateRotation persists a weekly set and recreates when missing or expired', () => {
  const candidates = sampleCandidates();
  const storage = memoryStorage();
  const now = 1_700_000_000_000;
  const first = getOrCreateRotation(candidates, storage, now, () => 0.4);
  assert.equal(first.items.length, FEATURED_COUNT);
  assert.ok(storage.getItem(FEATURED_STORAGE_KEY));

  const reused = getOrCreateRotation(candidates, storage, now + 3 * 24 * 60 * 60 * 1000, () => 0.9);
  assert.deepEqual(reused.items, first.items);
  assert.equal(reused.startedAt, first.startedAt);

  const expired = getOrCreateRotation(
    candidates,
    storage,
    now + FEATURED_ROTATION_MS + 1,
    () => 0.2
  );
  assert.equal(expired.items.length, FEATURED_COUNT);
  assert.ok(expired.startedAt > first.startedAt);
  assert.equal(expired.expiresAt, expired.startedAt + FEATURED_ROTATION_MS);
});

test('formatRemaining shows a compact weekly countdown', () => {
  assert.equal(formatRemaining(0), '0s');
  assert.equal(formatRemaining(45_000), '45s');
  assert.equal(formatRemaining(5 * 60 * 1000 + 12_000), '5m 12s');
  assert.equal(formatRemaining(3 * 60 * 60 * 1000 + 10 * 60 * 1000), '3h 10m');
  assert.equal(formatRemaining(6 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000), '6d 4h');
});

test('featured rotation rejects cover, banner, icon and logo assets', () => {
  assert.equal(isBrandingAsset('cover.jpg'), true);
  assert.equal(isBrandingAsset('/media/FIFA 15/banner.png'), true);
  assert.equal(isBrandingAsset('icon.ico'), true);
  assert.equal(isBrandingAsset('logo.webp'), true);
  assert.equal(isBrandingAsset('hero.jpg'), true);
  assert.equal(isBrandingAsset('/media/FIFA 15/images/screenshot_01.jpg'), false);
  assert.equal(isBrandingAsset('/media/HITMAN 3/videos/clip.mp4'), false);

  const mixed: FeaturedItem[] = [
    ...sampleCandidates().slice(0, 2),
    {
      gameId: 'branding',
      gameName: 'Branding',
      type: 'image',
      url: '/media/Game/cover.jpg',
    },
  ];
  const picked = pickFeaturedItems(mixed, FEATURED_COUNT, () => 0);
  assert.equal(picked.some((item) => item.url.endsWith('cover.jpg')), false);

  const now = 1_700_000_000_000;
  const invalid = createRotation(
    [
      {
        gameId: 'g1',
        gameName: 'G1',
        type: 'image',
        url: '/media/G1/banner.jpg',
      },
    ],
    now
  );
  assert.equal(isRotationValid(invalid, now + 1000), false);
});

test('media cache accepts library images and videos only', () => {
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/cover.jpg`), true);
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/banner.jpg`), true);
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/icon.png`), true);
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/images/shot.png`), true);
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip.mp4`), true);
  assert.equal(
    isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip/thumb.jpg`),
    true,
  );
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_BUCKET_URL}/FIFA%2015/cover.jpg`), true);
  assert.equal(isMediaAssetUrl('http://localhost:3000/__s3/FIFA%2015/cover.jpg'), true);
  assert.equal(isMediaAssetUrl(DEFAULT_MEDIA_WORKER_URL), false);
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/meta`), false);
  assert.equal(isMediaAssetUrl(`${DEFAULT_MEDIA_WORKER_URL}/games.json`), false);
  assert.equal(isMediaAssetUrl('https://example.com/cover.jpg'), false);
  assert.equal(isMediaAssetUrl('http://localhost:3000/icon.svg'), false);
  assert.equal(isMediaAssetUrl('not a url'), false);
});

test('details media cache collects screenshots and video thumbs', () => {
  const urls = collectGameMediaCacheUrls([
    {
      id: 'image-1',
      gameId: 'game-1',
      name: 'shot.png',
      type: 'screenshot',
      mimeType: 'image/png',
      size: 10,
      url: `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/images/shot.png`,
      thumbnailUrl: `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/images/shot.png`,
    },
    {
      id: 'video-1',
      gameId: 'game-1',
      name: 'clip.mp4',
      type: 'video',
      mimeType: 'video/mp4',
      size: 20,
      url: `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip.mp4`,
      thumbnailUrl: `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip/thumb.jpg`,
    },
  ]);

  assert.deepEqual(urls, [
    `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/images/shot.png`,
    `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip/thumb.jpg`,
  ]);
});

test('media URLs always point to the public bucket', () => {
  assert.equal(resolveMediaBaseUrl(), DEFAULT_MEDIA_BUCKET_URL);
  assert.equal(resolveMediaBaseUrl('https://cdn.example.com/media/'), 'https://cdn.example.com/media');

  assert.equal(
    buildMediaFileUrl(DEFAULT_MEDIA_BUCKET_URL, 'FIFA 15', 'cover.jpg'),
    `${DEFAULT_MEDIA_BUCKET_URL}/FIFA%2015/cover.jpg`
  );
  assert.equal(
    buildMediaFileUrl(DEFAULT_MEDIA_BUCKET_URL, 'FIFA 15', 'icon.png'),
    `${DEFAULT_MEDIA_BUCKET_URL}/FIFA%2015/icon.png`
  );
  assert.equal(
    buildMediaFileUrl(DEFAULT_MEDIA_BUCKET_URL, 'FIFA 15', 'banner.jpg'),
    `${DEFAULT_MEDIA_BUCKET_URL}/FIFA%2015/banner.jpg`
  );
  assert.equal(
    buildMediaFileUrl('https://cdn.example.com/media', 'FIFA 15', 'images/shot.png'),
    'https://cdn.example.com/media/FIFA%2015/images/shot.png'
  );
  assert.equal(resolveMediaWorkerUrl(), DEFAULT_MEDIA_WORKER_URL);
  assert.equal(
    resolveMediaWorkerUrl('https://game-clips-worker.example.workers.dev/'),
    'https://game-clips-worker.example.workers.dev'
  );
  assert.equal(gamesCatalogUrl(), DEFAULT_MEDIA_WORKER_URL);
  assert.equal(
    gamesCatalogUrl('https://game-clips-worker.example.workers.dev/'),
    'https://game-clips-worker.example.workers.dev'
  );
  assert.equal(
    gameImagesUrl(DEFAULT_MEDIA_WORKER_URL, 'Battlefield 6'),
    `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/images`
  );

  const battlefield: Game = {
    id: 'game-battlefield-6',
    name: 'Battlefield 6',
    playTimeMinutes: 0,
    subfolderName: 'Battlefield 6',
  };
  const images = mapListedImagesToMedia(battlefield, [
    {
      name: 'Battlefield 6 Screenshot 2026.10.18 - 00.49.08.50.png',
      relativePath: 'images/Battlefield 6 Screenshot 2026.10.18 - 00.49.08.50.png',
      size: 402321,
      mimeType: 'image/png',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/images/shot.png`,
    },
  ]);
  const datedImages = mapListedImagesToMedia(battlefield, [
    {
      name: '2026-02-28T132540Z_Battlefield 6#1.jpg',
      relativePath: 'images/2026-02-28T132540Z_Battlefield 6#1.jpg',
      size: 1,
      mimeType: 'image/jpeg',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/images/old.jpg`,
    },
    {
      name: '2026-10-18T004908Z_Battlefield 6#2.jpg',
      relativePath: 'images/2026-10-18T004908Z_Battlefield 6#2.jpg',
      size: 1,
      mimeType: 'image/jpeg',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/images/new.jpg`,
    },
    {
      name: '2026-10-18T004908Z_Battlefield 6#1.jpg',
      relativePath: 'images/2026-10-18T004908Z_Battlefield 6#1.jpg',
      size: 1,
      mimeType: 'image/jpeg',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/images/mid.jpg`,
    },
  ]);
  assert.deepEqual(
    datedImages.map((item) => item.name),
    [
      '2026-10-18T004908Z_Battlefield 6#2.jpg',
      '2026-10-18T004908Z_Battlefield 6#1.jpg',
      '2026-02-28T132540Z_Battlefield 6#1.jpg',
    ],
  );
  assert.equal(
    parseMediaCapturedAt('2026-02-28T132540Z_Battlefield 6#1.jpg')?.toISOString(),
    '2026-02-28T13:25:40.000Z',
  );
  assert.equal(
    parseMediaCapturedAt('legacy.png', '2026-01-02T03:04:05.000Z')?.toISOString(),
    '2026-01-02T03:04:05.000Z',
  );

  assert.equal(images.length, 1);
  assert.equal(images[0].type, 'screenshot');
  assert.equal(images[0].url, `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/images/shot.png`);
  assert.equal(images[0].thumbnailUrl, images[0].url);

  assert.equal(
    gameVideosUrl(DEFAULT_MEDIA_WORKER_URL, 'Battlefield 6'),
    `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos`
  );
  const videos = mapListedVideosToMedia(battlefield, [
    {
      name: '2026-03-09T114754Z_Battlefield 6#1.mp4',
      relativePath: 'videos/2026-03-09T114754Z_Battlefield 6#1/2026-03-09T114754Z_Battlefield 6#1.mp4',
      size: 2,
      mimeType: 'video/mp4',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/new.mp4`,
      thumbnailUrl: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/2026-03-09T114754Z_Battlefield%206%231/thumb.jpg`,
    },
    {
      name: '2026-02-28T132540Z_Battlefield 6#1.mp4',
      relativePath: 'videos/2026-02-28T132540Z_Battlefield 6#1/2026-02-28T132540Z_Battlefield 6#1.mp4',
      size: 2,
      mimeType: 'video/mp4',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/old.mp4`,
      thumbnailUrl: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/2026-02-28T132540Z_Battlefield%206%231/thumb.jpg`,
    },
  ]);
  assert.deepEqual(
    videos.map((item) => item.name),
    ['2026-03-09T114754Z_Battlefield 6#1.mp4', '2026-02-28T132540Z_Battlefield 6#1.mp4'],
  );

  const legacyVideo = mapListedVideosToMedia(battlefield, [
    {
      name: 'ClipedeMomentsdeOct102026 (5).mp4',
      relativePath: 'videos/ClipedeMomentsdeOct102026 (5)/ClipedeMomentsdeOct102026 (5).mp4',
      size: 451293402,
      mimeType: 'video/mp4',
      url: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/clip.mp4`,
      thumbnailUrl: `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/ClipedeMomentsdeOct102026%20(5)/thumb.jpg`,
    },
  ]);
  assert.equal(legacyVideo.length, 1);
  assert.equal(legacyVideo[0].type, 'video');
  assert.equal(
    legacyVideo[0].thumbnailUrl,
    `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/ClipedeMomentsdeOct102026%20(5)/thumb.jpg`
  );
  assert.equal(
    legacyVideo[0].url,
    `${DEFAULT_MEDIA_WORKER_URL}/Battlefield%206/videos/ClipedeMomentsdeOct102026%20(5)/ClipedeMomentsdeOct102026%20(5).mp4`
  );
  assert.equal(
    videoUrlBesideThumb(
      `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip.mp4`,
      `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip/thumb.jpg`,
      'clip.mp4',
    ),
    `${DEFAULT_MEDIA_WORKER_URL}/FIFA%2015/videos/clip/clip.mp4`
  );
  const hashed =
    `${DEFAULT_MEDIA_WORKER_URL}/Aliens%20Dark%20Descent/videos/` +
    '2026-02-28T132540Z_Aliens Dark Descent#1/2026-02-28T132540Z_Aliens Dark Descent#1.mp4';
  assert.equal(
    sanitizeVideoSrc(hashed),
    `${DEFAULT_MEDIA_WORKER_URL}/Aliens%20Dark%20Descent/videos/` +
      '2026-02-28T132540Z_Aliens%20Dark%20Descent%231/2026-02-28T132540Z_Aliens%20Dark%20Descent%231.mp4',
  );
  assert.equal(
    videoUrlBesideThumb(
      hashed,
      `${DEFAULT_MEDIA_WORKER_URL}/Aliens%20Dark%20Descent/videos/` +
        '2026-02-28T132540Z_Aliens%20Dark%20Descent%231/thumb.jpg',
      '2026-02-28T132540Z_Aliens Dark Descent#1.mp4',
    ),
    `${DEFAULT_MEDIA_WORKER_URL}/Aliens%20Dark%20Descent/videos/` +
      '2026-02-28T132540Z_Aliens%20Dark%20Descent%231/2026-02-28T132540Z_Aliens%20Dark%20Descent%231.mp4',
  );
});

test('route cache keys keep home stable and details keyed by game name', () => {
  const games: Game[] = [
    {
      id: 'game-agario',
      name: 'Agario',
      playTimeMinutes: 0,
      subfolderName: 'Agario',
    },
    {
      id: 'game-fifa-15',
      name: 'FIFA 15',
      playTimeMinutes: 0,
      subfolderName: 'FIFA 15',
    },
  ];

  assert.equal(resolveRouteCacheKey('/', undefined, games), HOME_CACHE_KEY);
  assert.equal(gameDetailsPath('Agario'), '/Agario');
  assert.equal(gameDetailsPath('FIFA 15'), '/FIFA%2015');
  assert.equal(resolveRouteCacheKey('/Agario', 'Agario', games), 'Agario');
  assert.equal(resolveRouteCacheKey('/FIFA 15', 'FIFA 15', games), 'FIFA 15');
  assert.equal(gameDetailsCacheKey(games[1]), 'FIFA 15');
  assert.equal(findGameByName(games, 'FIFA 15')?.name, 'FIFA 15');
  assert.equal(resolveRouteCacheKey('/missing', 'missing', games), null);
});

test('daily featured games persist for the local day and are hidden from the listing', () => {
  const catalog: Game[] = Array.from({ length: 6 }, (_, index) => ({
    id: `game-${index}`,
    name: `Game ${index}`,
    playTimeMinutes: 0,
    subfolderName: `Game ${index}`,
  }));
  const storage = memoryStorage();
  const day = new Date('2026-10-29T12:00:00');
  const nextDay = new Date('2026-10-30T08:00:00');

  const first = getOrCreateDailyFeaturedGames(catalog, storage, day, () => 0.2);
  assert.equal(first.length, DAILY_FEATURED_COUNT);
  assert.equal(new Set(first.map((game) => game.id)).size, DAILY_FEATURED_COUNT);
  assert.ok(storage.getItem(DAILY_FEATURED_STORAGE_KEY)?.includes('2026-10-29'));

  const reused = getOrCreateDailyFeaturedGames(catalog, storage, day, () => 0.9);
  assert.deepEqual(
    reused.map((game) => game.id),
    first.map((game) => game.id)
  );

  const rotated = getOrCreateDailyFeaturedGames(catalog, storage, nextDay, () => 0.8);
  assert.equal(rotated.length, DAILY_FEATURED_COUNT);
  assert.notDeepEqual(
    rotated.map((game) => game.id),
    first.map((game) => game.id)
  );

  const listing = gamesWithoutFeatured(catalog, first);
  assert.equal(listing.length, catalog.length - DAILY_FEATURED_COUNT);
  assert.equal(listing.some((game) => first.some((featured) => featured.id === game.id)), false);

  const searchHits = catalog.filter((game) => game.name === first[0].name);
  assert.equal(searchHits.length, 1);
  assert.equal(searchHits[0].id, first[0].id);
});

test('next daily featured countdown targets the following local midnight', () => {
  const afternoon = new Date(2026, 9, 29, 15, 30, 0);
  const next = nextDailyFeaturedAt(afternoon);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 9);
  assert.equal(next.getDate(), 30);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getSeconds(), 0);
  assert.equal(msUntilNextDailyFeatured(afternoon), next.getTime() - afternoon.getTime());

  const midnight = new Date(2026, 9, 30, 0, 0, 0);
  const followingMidnight = nextDailyFeaturedAt(midnight);
  assert.equal(followingMidnight.getDate(), 31);
  assert.equal(msUntilNextDailyFeatured(midnight), 24 * 60 * 60 * 1000);
});

test('featured media draws up to two images and two videos from metadata.json', () => {
  const game: Game = {
    id: 'game-battlefield-6',
    name: 'Battlefield 6',
    playTimeMinutes: 0,
    subfolderName: 'Battlefield 6',
  };
  const metadata = parseGameMetadata(
    JSON.stringify({
      images: [
        'https://cdn.example/a.jpg',
        'https://cdn.example/b.jpg',
        'https://cdn.example/c.png',
        'https://cdn.example/a.jpg',
      ],
      videos: [
        { url: 'https://cdn.example/v1.mp4', thumb: 'https://cdn.example/t1.jpg' },
        { url: 'https://cdn.example/v2.mp4', thumb: 'https://cdn.example/t2.jpg' },
        { url: 'https://cdn.example/v3.mp4', thumb: '' },
      ],
    }),
  );
  assert.ok(metadata);

  const random = featuredMediaRandom('2026-10-29:game-battlefield-6');
  const first = pickGameFeaturedMedia(game, metadata, random);
  const second = pickGameFeaturedMedia(
    game,
    metadata,
    featuredMediaRandom('2026-10-29:game-battlefield-6'),
  );

  assert.equal(first.filter((item) => item.type === 'screenshot').length, 2);
  assert.equal(first.filter((item) => item.type === 'video').length, 2);
  assert.deepEqual(
    first.map((item) => item.url),
    second.map((item) => item.url),
  );
  assert.equal(first[0].type, 'video');
  assert.equal(first[1].type, 'screenshot');
  assert.equal(new Set(first.filter((item) => item.type === 'screenshot').map((item) => item.url)).size, 2);
  assert.equal(first.find((item) => item.url.endsWith('v3.mp4'))?.thumbnailUrl, undefined);

  const sparse = pickGameFeaturedMedia(
    game,
    { images: ['https://cdn.example/only.jpg'], videos: [] },
    () => 0.4,
  );
  assert.equal(sparse.length, 1);
  assert.equal(sparse[0].type, 'screenshot');
  assert.equal(sparse[0].name, 'only.jpg');
  assert.equal(pickGameFeaturedMedia(game, { images: [], videos: [] }).length, 0);

  assert.equal(parseGameMetadata('not-json'), null);
  assert.equal(parseGameMetadata('{"images":[]}'), null);

  const zipped = zipFeaturedHighlights([
    [{ gameId: 'a', gameName: 'A', media: first[0] }],
    [
      { gameId: 'b', gameName: 'B', media: first[1] },
      { gameId: 'b', gameName: 'B', media: first[2] },
    ],
  ]);
  assert.deepEqual(
    zipped.map((item) => item.gameId),
    ['a', 'b', 'b'],
  );

  assert.equal(
    gameMetadataUrl(DEFAULT_MEDIA_BUCKET_URL, 'Battlefield 6'),
    `${DEFAULT_MEDIA_BUCKET_URL}/Battlefield%206/metadata.json`,
  );
});
