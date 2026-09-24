const ARABIC = /[؀-ۿ]/;
const LATIN_RUN = /[A-Za-z0-9][A-Za-z0-9+.,'’&/\-\s]*[A-Za-z0-9+)]|[A-Za-z0-9]/g;

export interface BidiRun {
  text: string;
  latin: boolean;
}

/** Split text into Latin and non-Latin runs; text without Arabic is returned as a single run. */
export function splitBidiRuns(text: string): BidiRun[] {
  if (!ARABIC.test(text)) return [{ text, latin: false }];
  const runs: BidiRun[] = [];
  let last = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const start = match.index;
    if (start > last) runs.push({ text: text.slice(last, start), latin: false });
    runs.push({ text: match[0], latin: true });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), latin: false });
  return runs;
}
