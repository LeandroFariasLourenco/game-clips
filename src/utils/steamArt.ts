/**
 * Game Utility Helpers
 * Formats playtime and duration for games.
 * Note: External CDN/mock art functions have been removed as all assets
 * (cover.jpg, banner.jpg, icon.png) are retrieved directly from Google Drive.
 */

export function formatPlaytime(minutes: number): string {
  if (!minutes || minutes <= 0) return 'Nunca jogado';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = (minutes / 60).toFixed(1);
  return `${hours.endsWith('.0') ? hours.slice(0, -2) : hours} h`;
}
