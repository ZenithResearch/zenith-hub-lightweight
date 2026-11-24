export const REPLY_WORDS_PER_MINUTE = 80;
export const REPLY_FADE_MS = 400;

const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;

/** Reading time for visible reply text, excluding punctuation and whitespace. */
export function replyDisplayMs(text: string) {
  const words = segmenter
    ? [...segmenter.segment(text)].filter((part) => part.isWordLike).length
    : (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
  return Math.ceil(words * 60000 / REPLY_WORDS_PER_MINUTE);
}
