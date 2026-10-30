const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z_(.+)#(\d+)$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DDTHHmmssZ` — UTC, parseable with `new Date("YYYY-MM-DDTHH:mm:ssZ")`. */
export function formatUtcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

export function formatFileDateStamp(date: Date): string {
  return formatUtcStamp(date);
}

export function formatLocalTimestamp(date: Date): string {
  return formatUtcStamp(date);
}

export function utcStampToIso(stamp: string): string {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return stamp;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

export function mediaFileLabel(gameName: string): string {
  return gameName.replace(/_/g, " ").trim() || "game";
}

export function fileBaseName(name: string): string {
  return name.split(/[\\/]/).pop() || name;
}

function splitName(fileName: string): { stem: string; ext: string } {
  const base = fileBaseName(fileName);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base, ext: "" };
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1) };
}

export function galleryExtension(kind: "image" | "video", ext: string): string {
  const lower = ext.toLowerCase();
  if (kind === "image" && (lower === "jpeg" || lower === "jpg")) return "jpg";
  return lower;
}

export function parseStandardizedMediaName(fileName: string): {
  stamp: string;
  iso: string;
  date: Date;
  game: string;
  sequence: number;
} | null {
  const match = splitName(fileName).stem.match(STAMP_RE);
  if (!match) return null;
  const stamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
  const iso = utcStampToIso(stamp);
  return {
    stamp,
    iso,
    date: new Date(iso),
    game: match[7],
    sequence: Number(match[8]),
  };
}

export function dateFromStandardizedName(fileName: string): Date | null {
  return parseStandardizedMediaName(fileName)?.date ?? null;
}

export function isStandardizedMediaName(fileName: string, gameName?: string): boolean {
  const parsed = parseStandardizedMediaName(fileName);
  if (!parsed || Number.isNaN(parsed.date.getTime())) return false;
  if (gameName !== undefined && parsed.game !== mediaFileLabel(gameName)) return false;
  return true;
}

export function buildStandardizedMediaName(
  date: Date,
  gameName: string,
  sequence: number,
  ext: string,
): string {
  const suffix = ext ? `.${ext.replace(/^\./, "")}` : "";
  return `${formatUtcStamp(date)}_${mediaFileLabel(gameName)}#${sequence}${suffix}`;
}

export function usedMediaSequences(names: Iterable<string>, gameName: string): Set<number> {
  const label = mediaFileLabel(gameName);
  const used = new Set<number>();
  for (const name of names) {
    const parsed = parseStandardizedMediaName(name);
    if (parsed && parsed.game === label) used.add(parsed.sequence);
  }
  return used;
}

function nextSequence(used: Set<number>): number {
  let sequence = 1;
  while (used.has(sequence)) sequence += 1;
  return sequence;
}

export function sequentialMediaNames(
  items: Array<{ date: Date | number; originalName: string }>,
  gameName: string,
  kind: "image" | "video",
  reserved: Iterable<string> = [],
): string[] {
  const used = usedMediaSequences(reserved, gameName);
  return items.map((item) => {
    const ext = galleryExtension(kind, splitName(item.originalName).ext);
    const sequence = nextSequence(used);
    used.add(sequence);
    return buildStandardizedMediaName(
      item.date instanceof Date ? item.date : new Date(item.date),
      gameName,
      sequence,
      ext,
    );
  });
}

export function standardizedMediaName(
  originalName: string,
  originalAt: Date | number,
  kind: "image" | "video",
  gameName: string,
  sequence: number,
): string {
  const ext = galleryExtension(kind, splitName(originalName).ext);
  return buildStandardizedMediaName(
    originalAt instanceof Date ? originalAt : new Date(originalAt),
    gameName,
    sequence,
    ext,
  );
}

export function uniqueMediaNames(names: string[], reserved: Iterable<string> = []): string[] {
  const used = new Set(Array.from(reserved, (name) => name.toLowerCase()));
  return names.map((name) => {
    const { stem, ext } = splitName(name);
    const suffix = ext ? `.${ext}` : "";
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem}-${n}${suffix}`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function mediaDestination(kind: "image" | "video", fileName: string): string {
  if (kind === "image") return `images/${fileName}`;
  const stem = splitName(fileName).stem;
  return `videos/${stem}/${fileName}`;
}
