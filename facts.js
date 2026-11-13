/**
 * Fact model, 91 unique commutative fact families (0x0..12x12),
 * teaching sequence groups, and local calendar-day utilities.
 */

export const MAX_FACTOR = 12;

export const TEACHING_GROUPS = [
  { id: 'x0x1', label: '×0 and ×1', factors: [0, 1] },
  { id: 'x10x2', label: '×10 and ×2', factors: [10, 2] },
  { id: 'x5', label: '×5', factors: [5] },
  { id: 'x11', label: '×11', factors: [11] },
  { id: 'x9', label: '×9', factors: [9] },
  { id: 'x3x4', label: '×3 and ×4', factors: [3, 4] },
  { id: 'x6', label: '×6', factors: [6] },
  { id: 'x7x8', label: '×7 and ×8', factors: [7, 8] },
  { id: 'x12', label: '×12', factors: [12] },
  { id: 'squares', label: 'Squares', factors: [] }
];

/**
 * Canonical key for a fact family: always min x max (e.g., "7x8").
 */
export function factKey(a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return `${min}x${max}`;
}

/**
 * Parse a canonical fact key ("7x8") into { a, b }.
 */
export function parseFactKey(key) {
  const [aStr, bStr] = key.split('x');
  return { a: Number(aStr), b: Number(bStr) };
}

/**
 * Generate all 91 unique fact families for 0..12.
 */
export function getAllFactKeys() {
  const keys = [];
  for (let a = 0; a <= MAX_FACTOR; a++) {
    for (let b = a; b <= MAX_FACTOR; b++) {
      keys.push(`${a}x${b}`);
    }
  }
  return keys;
}

export const ALL_FACT_KEYS = getAllFactKeys();

/**
 * Determine which teaching group introduces a given fact first.
 */
export function getPrimaryGroupForFact(a, b) {
  for (const group of TEACHING_GROUPS) {
    if (group.id === 'squares') continue;
    if (group.factors.includes(a) || group.factors.includes(b)) {
      return group.id;
    }
  }
  return 'squares';
}

/**
 * Return all teaching/strategy group IDs (in order from oldest to newest)
 * that apply to a fact (a, b).
 * Individual factor groups are mapped to their teaching group ID.
 */
export function getApplicableStrategyGroups(a, b) {
  const groups = [];
  const factorToStrategy = [
    { factor: 0, id: 'x0' },
    { factor: 1, id: 'x1' },
    { factor: 10, id: 'x10' },
    { factor: 2, id: 'x2' },
    { factor: 5, id: 'x5' },
    { factor: 11, id: 'x11' },
    { factor: 9, id: 'x9' },
    { factor: 3, id: 'x3' },
    { factor: 4, id: 'x4' },
    { factor: 6, id: 'x6' },
    { factor: 7, id: 'x7' },
    { factor: 8, id: 'x8' },
    { factor: 12, id: 'x12' }
  ];

  for (const entry of factorToStrategy) {
    if (a === entry.factor || b === entry.factor) {
      groups.push(entry.id);
    }
  }
  if (a === b) {
    groups.push('squares');
  }
  return groups;
}

/**
 * Get all fact keys whose primary introduction belongs to `groupId`.
 * For 'squares', returns all square facts (a === b) so group-level views work.
 */
export function getFactsIntroducedInGroup(groupId) {
  if (groupId === 'squares') {
    return ALL_FACT_KEYS.filter((k) => {
      const { a, b } = parseFactKey(k);
      return a === b;
    });
  }
  return ALL_FACT_KEYS.filter((k) => {
    const { a, b } = parseFactKey(k);
    return getPrimaryGroupForFact(a, b) === groupId;
  });
}

/**
 * Get all fact keys that belong to a factor table (e.g., all facts with 5).
 */
export function getFactsForFactor(factor) {
  return ALL_FACT_KEYS.filter((k) => {
    const { a, b } = parseFactKey(k);
    return a === factor || b === factor;
  });
}

/**
 * Format a timestamp as a local calendar date string "YYYY-MM-DD".
 */
export function toLocalDateString(ts = Date.now()) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Return the local midnight timestamp (00:00:00.000) for a given timestamp's calendar day,
 * plus `offsetDays` calendar days. Uses Date(y, m, d + offset) to handle DST cleanly.
 */
export function localMidnightTimestamp(ts = Date.now(), offsetDays = 0) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, 0, 0, 0, 0).getTime();
}

/**
 * Compute whole local calendar days elapsed from `fromTs` to `toTs`.
 * Guards against backward system clock: if `toTs < fromTs`, returns 0.
 */
export function localDaysBetween(fromTs, toTs) {
  if (!fromTs || toTs <= fromTs) return 0;
  const fromMid = localMidnightTimestamp(fromTs, 0);
  const toMid = localMidnightTimestamp(toTs, 0);
  const diff = Math.round((toMid - fromMid) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff);
}

/**
 * Create a fresh default fact record for key "a x b".
 */
export function createEmptyFact(key) {
  const { a, b } = parseFactKey(key);
  return {
    a,
    b,
    box: 0,
    attempts: 0,
    correct: 0,
    recentLatenciesMs: [],
    daysCorrectFast: [],
    lastSeen: 0,
    due: 0,
    lastWrong: 0,
    strategyViewed: false
  };
}

/**
 * Determine a fact's display category: 'new' | 'learning' | 'review' | 'mastered'.
 */
export function getFactCategory(fact) {
  if (!fact || (fact.attempts === 0 && fact.box === 0 && !fact.strategyViewed)) {
    return 'new';
  }
  if (fact.box >= 5) return 'mastered';
  if (fact.box >= 3) return 'review';
  return 'learning';
}

/**
 * Map a fact to its Garden growth stage ('unseen' | 0..5).
 */
export function getGardenStage(fact) {
  if (!fact || (fact.attempts === 0 && fact.box === 0 && !fact.strategyViewed)) {
    return 'unseen';
  }
  return Math.max(0, Math.min(5, fact.box));
}
