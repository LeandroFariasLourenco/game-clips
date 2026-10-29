const STANDARDIZED_STEM = /^\d{14}-.+/;

export function formatLocalTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
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

export function standardizedMediaName(
  originalName: string,
  modifiedAt: Date | number,
  kind: "image" | "video",
): string {
  const { stem, ext } = splitName(originalName);
  const nextExt = galleryExtension(kind, ext);
  const suffix = nextExt ? `.${nextExt}` : "";
  if (STANDARDIZED_STEM.test(stem)) return `${stem}${suffix}`;
  const stamp = formatLocalTimestamp(modifiedAt instanceof Date ? modifiedAt : new Date(modifiedAt));
  return `${stamp}-${stem}${suffix}`;
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
