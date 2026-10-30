import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStandardizedMediaName,
  datedMediaFileName,
  dateFromStandardizedName,
  formatFileDateStamp,
  formatUtcStamp,
  isStandardizedMediaName,
  mediaFileLabel,
  mediaStemFromFileName,
  parseStandardizedMediaName,
} from "../src/mediaNames.ts";

export {
  buildStandardizedMediaName,
  datedMediaFileName,
  dateFromStandardizedName,
  formatFileDateStamp,
  formatUtcStamp,
  isStandardizedMediaName,
  mediaFileLabel,
  mediaStemFromFileName,
  parseStandardizedMediaName,
};

const require = createRequire(import.meta.url);
const itemDateCjs = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/lib/item-date.cjs");

type ReadItemDates = (paths: string[]) => Map<string, Date>;

const readItemDatesSync: ReadItemDates = existsSync(itemDateCjs)
  ? (require(itemDateCjs) as { readItemDates: ReadItemDates }).readItemDates
  : (paths) => {
      const dates = new Map<string, Date>();
      for (const filePath of paths) dates.set(resolve(filePath), statSync(filePath).mtime);
      return dates;
    };

export function readItemDates(filePaths: string[]): Map<string, Date> {
  return readItemDatesSync(filePaths);
}
