/**
 * Lightweight fuzzy subsequence matcher with scoring.
 *
 * Returns a score between 0 and 1, and the matching character index ranges
 * for highlighting. Returns null if the query does not match the target.
 *
 * Scoring heuristics:
 * - Consecutive character matches score higher
 * - Matches at the start of the string score higher
 * - Matches after separators (/ \ . - _) score higher (path boundary)
 * - Shorter targets score higher (tighter match)
 */
export interface FuzzyResult {
    score: number;
    /** Pairs of [start, end) indices into `target` that matched */
    highlights: [number, number][];
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
    if (!query) return { score: 1, highlights: [] };

    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();

    // Quick check: all characters of query exist in target in order
    let qi = 0;
    for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
        if (targetLower[ti] === queryLower[qi]) qi++;
    }
    if (qi < queryLower.length) return null;

    // Scored matching pass
    const highlights: [number, number][] = [];
    let score = 0;
    let consecutive = 0;
    let lastMatchIndex = -2;

    qi = 0;
    for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
        if (targetLower[ti] === queryLower[qi]) {
            let charScore = 1;

            // Bonus: consecutive match
            if (ti === lastMatchIndex + 1) {
                consecutive++;
                charScore += consecutive * 2;
            } else {
                consecutive = 0;
            }

            // Bonus: match at string start
            if (ti === 0) charScore += 5;

            // Bonus: match after separator (path boundary or word boundary)
            if (ti > 0) {
                const prev = target[ti - 1];
                if (prev === '/' || prev === '\\' || prev === '.' || prev === '-' || prev === '_' || prev === ' ') {
                    charScore += 3;
                }
                // camelCase boundary
                const cur = target[ti];
                if (cur >= 'A' && cur <= 'Z' && prev >= 'a' && prev <= 'z') {
                    charScore += 2;
                }
            }

            score += charScore;
            lastMatchIndex = ti;

            // Build highlight ranges (merge consecutive)
            if (highlights.length > 0 && highlights[highlights.length - 1][1] === ti) {
                highlights[highlights.length - 1][1] = ti + 1;
            } else {
                highlights.push([ti, ti + 1]);
            }

            qi++;
        }
    }

    // Normalize score to 0~1 range
    const maxPossible = queryLower.length * 10;
    const lengthPenalty = Math.max(0, 1 - (target.length - query.length) / 100);
    const normalizedScore = Math.min(1, (score / maxPossible) * lengthPenalty);

    return { score: normalizedScore, highlights };
}
