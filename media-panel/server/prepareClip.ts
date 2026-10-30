import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const impl = require("../../scripts/lib/prepare-clip.cjs") as {
  VIDEO_THUMB_FILE: string;
  prepareVideoFile: (videoPath: string, options?: PrepareClipOptions) => PrepareClipResult;
  prepareVideoFiles: (videoPaths: string[], options?: PrepareClipOptions) => PrepareClipResult[];
};

export const VIDEO_THUMB_FILE = impl.VIDEO_THUMB_FILE;

export interface PrepareClipOptions {
  force?: boolean;
  dryRun?: boolean;
  faststart?: boolean;
  thumb?: boolean;
}

export interface PrepareClipResult {
  videoPath: string;
  thumbPath: string | null;
  faststart: "already" | "remuxed" | "dry-run" | "skipped";
  thumb: "existing" | "generated" | "dry-run" | "skipped";
}

export function prepareVideoFile(videoPath: string, options?: PrepareClipOptions): PrepareClipResult {
  return impl.prepareVideoFile(videoPath, options);
}

export function prepareVideoFiles(videoPaths: string[], options?: PrepareClipOptions): PrepareClipResult[] {
  return impl.prepareVideoFiles(videoPaths, options);
}
