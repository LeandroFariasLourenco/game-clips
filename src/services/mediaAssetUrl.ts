import { DEV_MEDIA_PROXY_PREFIX, resolveMediaBaseUrl } from '../config/mediaConfig';

const MEDIA_EXTENSION = /\.(?:jpe?g|png|webp|gif|ico|mp4|webm|mkv|mov|avi)$/i;

function mediaHosts(): Set<string> {
  return new Set([new URL(resolveMediaBaseUrl(import.meta.env?.VITE_MEDIA_BUCKET_URL)).host]);
}

/** Images and videos served by the CDN or the dev proxy. */
export function isMediaAssetUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw, 'http://localhost');
  } catch {
    return false;
  }

  if (!MEDIA_EXTENSION.test(decodeURIComponent(url.pathname))) return false;
  if (url.pathname.startsWith(`${DEV_MEDIA_PROXY_PREFIX}/`)) return true;
  return mediaHosts().has(url.host);
}
