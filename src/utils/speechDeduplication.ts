/**
 * Speech Recognition Deduplication & Transcript Utilities for YAAD
 * 
 * Prevents word duplication in Web Speech API on Android WebView and Chrome
 * where interim results, repeated final events, or session restarts can cause
 * duplicate words (e.g. "خرید خرید خرید").
 */

/**
 * Appends a newly finalized transcript chunk to an existing text without duplicating words or phrases.
 */
export function appendWithoutDuplicate(existingText: string, newChunk: string): string {
  const cleanExisting = (existingText || '').trim();
  const cleanChunk = (newChunk || '').trim();

  if (!cleanChunk) return cleanExisting;
  if (!cleanExisting) return cleanChunk;

  const lowerExisting = cleanExisting.toLowerCase();
  const lowerChunk = cleanChunk.toLowerCase();

  // 1. Exact match: existing text is already exactly the chunk
  if (lowerExisting === lowerChunk) {
    return cleanExisting;
  }

  // 2. Existing text already ends with this exact chunk (e.g. "یادآور خرید" + "خرید")
  if (lowerExisting.endsWith(' ' + lowerChunk)) {
    return cleanExisting;
  }

  const existingWords = cleanExisting.split(/\s+/).filter(Boolean);
  const chunkWords = cleanChunk.split(/\s+/).filter(Boolean);

  if (existingWords.length > 0 && chunkWords.length > 0) {
    // 3. If the entire new chunk is a single word and matches the last word
    if (
      chunkWords.length === 1 &&
      existingWords[existingWords.length - 1].toLowerCase() === chunkWords[0].toLowerCase()
    ) {
      return cleanExisting;
    }

    // 4. Overlap check: e.g. existing ends with ["خرید"], chunk is ["خرید", "نان"] -> append only "نان"
    const maxOverlap = Math.min(existingWords.length, chunkWords.length);
    for (let overlap = maxOverlap; overlap >= 1; overlap--) {
      const existingSlice = existingWords
        .slice(-overlap)
        .map((w) => w.toLowerCase())
        .join(' ');
      const chunkSlice = chunkWords
        .slice(0, overlap)
        .map((w) => w.toLowerCase())
        .join(' ');

      if (existingSlice === chunkSlice) {
        const remainingWords = chunkWords.slice(overlap);
        if (remainingWords.length === 0) {
          return cleanExisting;
        }
        return `${cleanExisting} ${remainingWords.join(' ')}`;
      }
    }
  }

  return `${cleanExisting} ${cleanChunk}`;
}

/**
 * Cleanly tears down a SpeechRecognition instance by stripping all listeners first
 * to avoid dangling callbacks during garbage collection or restarts.
 */
export function safeAbortSpeechRecognition(rec: any): void {
  if (!rec) return;
  try {
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.onstart = null;
    rec.onaudioend = null;
    rec.onsoundend = null;
    rec.onspeechend = null;
    rec.abort();
  } catch {
    // Ignore browser abort errors
  }
}
