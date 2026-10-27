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
  gamesCatalogUrl,
  matchBrandingAsset,
  resolveMediaBaseUrl,
  resolveMediaWorkerUrl,
} from '../config/mediaConfig';
import { HOME_CACHE_KEY, gameDetailsCacheKey, resolveRouteCacheKey } from '../libraryContext';
import { localAssetService } from '../services/driveAssetService';
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
  assert.equal(resolveRouteCacheKey('/game/game-agario', 'game-agario', games), 'Agario');
  assert.equal(resolveRouteCacheKey('/game/game-fifa-15', 'game-fifa-15', games), 'FIFA 15');
  assert.equal(gameDetailsCacheKey(games[1]), 'FIFA 15');
  assert.equal(resolveRouteCacheKey('/game/missing', 'missing', games), null);
});
