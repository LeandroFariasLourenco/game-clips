const STAMP_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T\d{6}Z)_/;
const SEQUENCE_RE = /#(\d+)(?:\.[^.]+)?$/;

function fileBaseName(name: string): string {
  return name.split(/[\\/]/).pop() || name;
}

export function mediaNameSortKey(name: string): { stamp: string; sequence: number } {
  const base = fileBaseName(name);
  const stamp = base.match(STAMP_PREFIX_RE)?.[1] || '';
  const sequence = Number(base.match(SEQUENCE_RE)?.[1] || 0);
  return { stamp, sequence };
}

export function compareMediaNewestFirst(
  a: { name: string; createdTime?: string },
  b: { name: string; createdTime?: string },
): number {
  const keyA = mediaNameSortKey(a.name);
  const keyB = mediaNameSortKey(b.name);
  if (keyA.stamp || keyB.stamp) {
    const stampCmp = keyB.stamp.localeCompare(keyA.stamp);
    if (stampCmp !== 0) return stampCmp;
    if (keyB.sequence !== keyA.sequence) return keyB.sequence - keyA.sequence;
  }

  const timeA = a.createdTime || '';
  const timeB = b.createdTime || '';
  if (timeA || timeB) return timeB.localeCompare(timeA);

  return b.name.localeCompare(a.name, 'pt', { sensitivity: 'base' });
}

export function sortMediaNewestFirst<T extends { name: string; createdTime?: string }>(items: T[]): T[] {
  return [...items].sort(compareMediaNewestFirst);
}

function stampToDate(stamp: string): Date | null {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseMediaCapturedAt(name: string, createdTime?: string): Date | null {
  const fromName = stampToDate(mediaNameSortKey(name).stamp);
  if (fromName) return fromName;
  if (!createdTime) return null;
  const fromMeta = new Date(createdTime);
  return Number.isNaN(fromMeta.getTime()) ? null : fromMeta;
}

export function formatMediaCapturedAt(name: string, createdTime?: string): string | null {
  const date = parseMediaCapturedAt(name, createdTime);
  if (!date) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
