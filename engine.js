/**
 * Pure-function spaced-repetition engine, queue builder, placement logic,
 * and progress/badge calculations. Zero DOM dependencies.
 */

import {
  ALL_FACT_KEYS,
  TEACHING_GROUPS,
  createEmptyFact,
  getFactsForFactor,
  getFactsIntroducedInGroup,
  localDaysBetween,
  localMidnightTimestamp,
  parseFactKey,
  toLocalDateString
} from './facts.js';

export const BOX_INTERVAL_DAYS = {
  0: 0,
  1: 1,
  2: 1,
  3: 3,
  4: 7,
  5: 21
};

/**
 * Deterministic seedable PRNG (Mulberry32).
 */
export function createRng(seed = Date.now()) {
  let s = seed >>> 0;
  return function next() {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle an array in-place using Fisher-Yates with the given rng.
 */
export function shuffle(arr, rng = Math.random) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Compute median of a numeric array.
 */
export function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fast threshold: base (default 4000ms) + 800ms for 3-digit answers (>= 100).
 */
export function getFastThresholdMs(a, b, baseThresholdMs = 4000) {
  return a * b >= 100 ? baseThresholdMs + 800 : baseThresholdMs;
}

/**
 * Apply typo guard: if total time exceeds 15s, cap recorded latency at 15001ms
 * so it counts as slow-correct without skewing medians.
 */
export function normalizeLatencyMs(rawMs) {
  const clamped = Math.max(0, Math.round(rawMs));
  return clamped > 15000 ? 15001 : clamped;
}

/**
 * Determine whether a correct trial counts as "fast" using median-of-3 rule:
 * this trial must be <= threshold, AND if >= 3 trials exist, median of last 3 <= threshold.
 */
export function isTrialFast(fact, trialLatencyMs, baseThresholdMs = 4000) {
  const threshold = getFastThresholdMs(fact.a, fact.b, baseThresholdMs);
  if (trialLatencyMs > threshold) return false;
  const lastThree = [...(fact.recentLatenciesMs || []).slice(-2), trialLatencyMs];
  if (lastThree.length < 3) return true;
  return median(lastThree) <= threshold;
}

/**
 * Compute due timestamp with +/- 10% jitter (rounded to whole days, min 1 day)
 * aligned to local calendar midnight so midnight rollover is exact.
 */
export function computeNextDue(now, intervalDays, rng = Math.random) {
  if (intervalDays <= 0) return now;
  const jitterFactor = 0.9 + rng() * 0.2; // 0.9 .. 1.1
  const jitteredDays = Math.max(1, Math.round(intervalDays * jitterFactor));
  return localMidnightTimestamp(now, jitteredDays);
}

/**
 * Compute how overdue a fact is as a ratio of its scheduled interval.
 */
export function getOverdueRatio(fact, now) {
  if (!fact || !fact.due || fact.due > now) return 0;
  const expectedDays = BOX_INTERVAL_DAYS[fact.box] || 1;
  const expectedMs = expectedDays * 24 * 60 * 60 * 1000;
  return Math.max(0, (now - fact.due) / expectedMs);
}

/**
 * Evaluate a single answered trial against a fact record (pure function).
 * Returns { updatedFact, outcome, reaskOffsets, retryOffset, promoted, demoted }.
 *
 * Pedagogical rules implemented:
 * - Wrong answers drop box (0/1->0, 2->1, >=3->2) and schedule in-session re-asks
 *   (after 2-3 items, 5-7 items, and session end) because retrieval practice after
 *   error correction cements the corrected memory.
 * - Re-asks in the same session never promote beyond box 1.
 * - Box 5 (mastered) requires correct-and-fast answers on 3 distinct calendar days.
 * - Overdue grace (>2x interval) prevents punishing a child returning after a break.
 */
export function evaluateTrial(fact, trial, settings = {}, rng = Math.random) {
  const now = trial.now ?? Date.now();
  // Guard against backward system clock
  const effectiveNow = fact.lastSeen && now < fact.lastSeen ? fact.lastSeen : now;
  const todayStr = toLocalDateString(effectiveNow);
  const baseThreshold = settings.fastThresholdMs ?? 4000;

  const updated = {
    ...fact,
    recentLatenciesMs: [...(fact.recentLatenciesMs || [])],
    daysCorrectFast: [...(fact.daysCorrectFast || [])]
  };

  updated.attempts += 1;
  updated.lastSeen = effectiveNow;

  // Idle guard: paused trials do not record latency or penalize
  if (trial.paused) {
    return {
      updatedFact: updated,
      outcome: 'paused',
      reaskOffsets: [],
      retryOffset: null,
      promoted: false,
      demoted: false
    };
  }

  if (!trial.correct) {
    const prevBox = updated.box;
    if (prevBox <= 1) {
      updated.box = 0;
    } else if (prevBox === 2) {
      updated.box = 1;
    } else {
      updated.box = 2;
    }
    updated.lastWrong = effectiveNow;
    updated.due = localMidnightTimestamp(effectiveNow, 1);

    // Re-ask after 2-3 items, 5-7 items, and once more at session end
    const firstGap = 2 + Math.floor(rng() * 2); // 2 or 3
    const secondGap = 5 + Math.floor(rng() * 3); // 5, 6, or 7

    return {
      updatedFact: updated,
      outcome: 'wrong',
      reaskOffsets: [firstGap, secondGap],
      reaskAtEnd: true,
      retryOffset: null,
      promoted: false,
      demoted: updated.box < prevBox
    };
  }

  // Correct answer
  updated.correct += 1;
  const recordedLatency = normalizeLatencyMs(trial.latencyMs ?? 0);
  const fast = isTrialFast(updated, recordedLatency, baseThreshold);

  updated.recentLatenciesMs.push(recordedLatency);
  if (updated.recentLatenciesMs.length > 5) {
    updated.recentLatenciesMs = updated.recentLatenciesMs.slice(-5);
  }

  const overdueRatio = getOverdueRatio(fact, effectiveNow);
  const overdueGrace = overdueRatio > 2;

  if (fast) {
    if (!updated.daysCorrectFast.includes(todayStr)) {
      updated.daysCorrectFast.push(todayStr);
    }

    // Half-weight mode (missing factor / division): requires 2 successes to promote
    if (trial.halfWeight) {
      const prevHalf = updated._halfWeightCredit || 0;
      if (prevHalf + 1 < 2) {
        updated._halfWeightCredit = prevHalf + 1;
        updated.due = computeNextDue(effectiveNow, BOX_INTERVAL_DAYS[updated.box] || 1, rng);
        return {
          updatedFact: updated,
          outcome: 'correct-fast-half',
          reaskOffsets: [],
          retryOffset: null,
          promoted: false,
          demoted: false
        };
      }
      updated._halfWeightCredit = 0;
    }

    const prevBox = updated.box;
    let nextBox = prevBox;

    if (trial.isSessionReask) {
      // Same-session re-asks after error do not promote beyond box 1
      nextBox = Math.min(1, prevBox + 1);
    } else if (overdueGrace && prevBox < 2) {
      // Overdue grace: do not demote; promote only if box >= 2
      nextBox = prevBox;
    } else {
      nextBox = Math.min(5, prevBox + 1);
      // Mastery rule: box 5 requires 3 distinct calendar days of correct-and-fast
      if (nextBox === 5 && updated.daysCorrectFast.length < 3) {
        nextBox = 4;
      }
    }

    updated.box = nextBox;
    const intervalDays = BOX_INTERVAL_DAYS[nextBox] || 1;
    updated.due = computeNextDue(effectiveNow, intervalDays, rng);

    return {
      updatedFact: updated,
      outcome: 'correct-fast',
      reaskOffsets: [],
      retryOffset: null,
      promoted: nextBox > prevBox,
      demoted: false
    };
  }

  // Correct but slow: do not change box; next due = shorter of current interval and 1 day
  updated.due = localMidnightTimestamp(effectiveNow, 1);
  const retryGap = 6 + Math.floor(rng() * 3); // 6, 7, or 8 items
  return {
    updatedFact: updated,
    outcome: 'correct-slow',
    reaskOffsets: [],
    retryOffset: retryGap,
    promoted: false,
    demoted: false
  };
}

/**
 * Check if the next teaching group should unlock (>= 80% of current group's facts in box >= 3).
 * Returns updated unlockedGroups array.
 */
export function checkGroupUnlocks(facts, unlockedGroups = ['x0x1'], unlockOverride = null) {
  if (Array.isArray(unlockOverride) && unlockOverride.length > 0) {
    return [...new Set([...unlockedGroups, ...unlockOverride])];
  }
  const current = [...unlockedGroups];
  for (let i = 0; i < TEACHING_GROUPS.length - 1; i++) {
    const grp = TEACHING_GROUPS[i];
    if (!current.includes(grp.id)) break;
    const nextGrp = TEACHING_GROUPS[i + 1];
    if (current.includes(nextGrp.id)) continue;

    const grpFacts = getFactsIntroducedInGroup(grp.id);
    if (grpFacts.length === 0) {
      current.push(nextGrp.id);
      continue;
    }
    const solidCount = grpFacts.filter((k) => (facts[k]?.box ?? 0) >= 3).length;
    if (solidCount / grpFacts.length >= 0.8) {
      current.push(nextGrp.id);
    } else {
      break;
    }
  }
  return current;
}

/**
 * Helper: check if two fact keys share any factor (for interleaving).
 */
export function shareFactor(keyA, keyB) {
  if (!keyA || !keyB) return false;
  const a = parseFactKey(keyA);
  const b = parseFactKey(keyB);
  return a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
}

/**
 * Interleave items so no two items from the same factor group appear back-to-back
 * (when avoidable) and the same fact never appears within 3 items of itself.
 */
export function interleaveItems(items, existingTail = [], rng = Math.random) {
  const pool = shuffle(items, rng);
  const result = [];
  const recentKeys = [...existingTail.slice(-3)];

  while (pool.length > 0) {
    const lastKey = result.length > 0 ? result[result.length - 1] : recentKeys[recentKeys.length - 1];
    const lastThree = [...recentKeys, ...result].slice(-3);

    // Best candidate: not in last 3 AND does not share a factor with lastKey
    let idx = pool.findIndex((k) => !lastThree.includes(k) && !shareFactor(k, lastKey));
    if (idx === -1) {
      // Fallback 1: not in last 3
      idx = pool.findIndex((k) => !lastThree.includes(k));
    }
    if (idx === -1) {
      // Fallback 2: does not share factor
      idx = pool.findIndex((k) => !shareFactor(k, lastKey));
    }
    if (idx === -1) {
      idx = 0;
    }
    const [picked] = pool.splice(idx, 1);
    result.push(picked);
  }
  return result;
}

/**
 * Create a queue item object.
 */
function makeQueueItem(key, kind, rng) {
  const { a, b } = parseFactKey(key);
  const swap = a !== b && rng() < 0.5;
  return {
    key,
    displayA: swap ? b : a,
    displayB: swap ? a : b,
    kind, // 'warmup' | 'review' | 'teach' | 'rehearsal' | 'fill' | 'cooldown' | 'reask' | 'retry'
    isSessionReask: kind === 'reask'
  };
}

/**
 * Build a session queue according to Section 2.5.
 * Pure function with seedable RNG.
 */
export function buildSessionQueue(state, now = Date.now(), rng = Math.random) {
  const facts = state.facts || {};
  const settings = state.settings || {};
  const unlockedGroups = state.unlockedGroups || ['x0x1'];
  const sessionMinutes = settings.sessionMinutes ?? 8;
  const newPerSession = settings.newPerSession ?? 3;
  const targetN = Math.max(8, Math.round(sessionMinutes * 6));
  const todayStr = toLocalDateString(now);

  // Collect all facts belonging to unlocked groups
  const unlockedKeys = [];
  for (const gId of unlockedGroups) {
    for (const k of getFactsIntroducedInGroup(gId)) {
      if (!unlockedKeys.includes(k)) unlockedKeys.push(k);
    }
  }

  // 1. Due review items (due <= now && box >= 1), ordered by overdue ratio descending
  const allDue = unlockedKeys
    .filter((k) => {
      const f = facts[k];
      return f && f.box >= 1 && f.due > 0 && f.due <= now;
    })
    .sort((k1, k2) => getOverdueRatio(facts[k2], now) - getOverdueRatio(facts[k1], now));

  const dueCap = Math.floor(targetN * 0.6);
  const selectedDue = allDue.slice(0, dueCap);

  // 2. Warm-up: 2 easy facts (box >= 4 or x0/x1/x10 already seen or in unlocked x0x1)
  const easyCandidates = unlockedKeys.filter((k) => {
    const f = facts[k];
    const { a, b } = parseFactKey(k);
    const isEasyGroup = a <= 1 || b <= 1 || a === 10 || b === 10;
    return (f && f.box >= 4) || (isEasyGroup && (!f || f.box >= 1 || f.attempts > 0));
  });
  const warmupPool = easyCandidates.length >= 2 ? easyCandidates : unlockedKeys;
  const warmupKeys = shuffle(warmupPool, rng).slice(0, 2);

  // 3. New facts check:
  // Only if facts currently in boxes 0..2 (active learning) <= 12 AND due backlog <= 15
  const activeLearningCount = unlockedKeys.filter((k) => {
    const f = facts[k];
    return f && f.box >= 0 && f.box <= 2 && (f.attempts > 0 || f.strategyViewed);
  }).length;

  const unseenUnlocked = unlockedKeys.filter((k) => {
    const f = facts[k];
    return !f || (f.attempts === 0 && f.box === 0 && !f.strategyViewed);
  });

  let newFactKeys = [];
  if (activeLearningCount <= 12 && allDue.length <= 15 && newPerSession > 0) {
    newFactKeys = unseenUnlocked.slice(0, newPerSession);
  }

  // Known facts pool (box >= 3, fallback to box >= 1 or easy facts)
  let knownPool = unlockedKeys.filter((k) => (facts[k]?.box ?? 0) >= 3);
  if (knownPool.length === 0) {
    knownPool = unlockedKeys.filter((k) => (facts[k]?.box ?? 0) >= 1);
  }
  if (knownPool.length === 0) {
    knownPool = unlockedKeys.filter((k) => !newFactKeys.includes(k));
  }

  // 4. Build middle section: due review + incremental rehearsal for new facts
  const queueItems = [];
  for (const wk of warmupKeys) {
    queueItems.push(makeQueueItem(wk, 'warmup', rng));
  }

  const interleavedDue = interleaveItems(selectedDue, warmupKeys, rng);
  for (const dk of interleavedDue) {
    queueItems.push(makeQueueItem(dk, 'review', rng));
  }

  // Incremental rehearsal pattern for each new fact:
  // [teach] -> [new] -> [known] -> [new] -> [known, known] -> [new] -> [known, known, known] -> [new]
  let knownCursor = 0;
  const pickKnown = (avoidKey) => {
    if (knownPool.length === 0) return warmupKeys[0] || unlockedKeys[0];
    for (let tries = 0; tries < knownPool.length; tries++) {
      const candidate = knownPool[(knownCursor + tries) % knownPool.length];
      if (candidate !== avoidKey) {
        knownCursor = (knownCursor + tries + 1) % knownPool.length;
        return candidate;
      }
    }
    return knownPool[knownCursor++ % knownPool.length];
  };

  for (const nk of newFactKeys) {
    queueItems.push(makeQueueItem(nk, 'teach', rng));
    queueItems.push(makeQueueItem(nk, 'rehearsal', rng));
    queueItems.push(makeQueueItem(pickKnown(nk), 'fill', rng));
    queueItems.push(makeQueueItem(nk, 'rehearsal', rng));
    queueItems.push(makeQueueItem(pickKnown(nk), 'fill', rng));
    queueItems.push(makeQueueItem(pickKnown(nk), 'fill', rng));
    queueItems.push(makeQueueItem(nk, 'rehearsal', rng));
    queueItems.push(makeQueueItem(pickKnown(nk), 'fill', rng));
    queueItems.push(makeQueueItem(pickKnown(nk), 'fill', rng));
    queueItems.push(makeQueueItem(pickKnown(nk), 'fill', rng));
    queueItems.push(makeQueueItem(nk, 'rehearsal', rng));
  }

  // 8. Fill if queue < targetN - 2 (leaving 2 slots for cool-down)
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const learningNotToday = unlockedKeys.filter((k) => {
    const f = facts[k];
    if (!f || f.box < 1 || f.box > 3) return false;
    return toLocalDateString(f.lastSeen) !== todayStr;
  });
  const masteredNotWeek = unlockedKeys.filter((k) => {
    const f = facts[k];
    if (!f || f.box < 4) return false;
    return f.lastSeen < sevenDaysAgo;
  });
  const anyUnlocked = unlockedKeys.filter((k) => !newFactKeys.includes(k));

  const fillCandidates = interleaveItems(
    [...learningNotToday, ...masteredNotWeek],
    queueItems.map((q) => q.key),
    rng
  );

  let fillIdx = 0;
  while (queueItems.length < targetN - 2 && fillIdx < fillCandidates.length) {
    const cand = fillCandidates[fillIdx++];
    const recent3 = queueItems.slice(-3).map((q) => q.key);
    if (!recent3.includes(cand)) {
      queueItems.push(makeQueueItem(cand, 'fill', rng));
    }
  }

  // If still short (e.g. brand new learner with only x0x1 unlocked), cycle unlocked known/warmup facts
  let safety = 0;
  while (queueItems.length < targetN - 2 && anyUnlocked.length > 0 && safety < 100) {
    safety++;
    const recent3 = queueItems.slice(-3).map((q) => q.key);
    const pool = shuffle(anyUnlocked, rng);
    const cand = pool.find((k) => !recent3.includes(k) && !shareFactor(k, recent3[recent3.length - 1]))
      || pool.find((k) => !recent3.includes(k))
      || pool[0];
    queueItems.push(makeQueueItem(cand, 'fill', rng));
  }

  // 7. Cool-down: 2 easy/known facts at the end (replaced dynamically during play with facts answered correctly earlier)
  const cooldownKeys = shuffle(warmupPool, rng).slice(0, 2);
  for (const ck of cooldownKeys) {
    queueItems.push(makeQueueItem(ck, 'cooldown', rng));
  }

  return queueItems;
}

/**
 * Sample ~20 facts across all teaching groups for the Placement Check (2.6).
 */
export function buildPlacementQuestions(rng = Math.random) {
  const picked = [];
  for (const grp of TEACHING_GROUPS) {
    if (grp.id === 'squares') continue;
    const grpFacts = getFactsIntroducedInGroup(grp.id);
    if (grpFacts.length === 0) continue;
    const count = grpFacts.length <= 2 ? grpFacts.length : (grp.id === 'x7x8' || grp.id === 'x3x4' ? 3 : 2);
    const sample = shuffle(grpFacts, rng).slice(0, count);
    for (const k of sample) {
      if (!picked.includes(k)) picked.push(k);
    }
  }
  return picked.slice(0, 20).map((key) => {
    const { a, b } = parseFactKey(key);
    const swap = a !== b && rng() < 0.5;
    return {
      key,
      groupId: TEACHING_GROUPS.find((g) => getFactsIntroducedInGroup(g.id).includes(key))?.id || 'x0x1',
      displayA: swap ? b : a,
      displayB: swap ? a : b
    };
  });
}

/**
 * Apply placement check results to `facts` and `unlockedGroups` (2.6).
 * - Fast & correct -> box 3 (due in 3 days)
 * - Slow & correct -> box 2 (due in 1 day)
 * - Wrong or skipped -> unseen (box 0)
 * - Group-level inference: >=80% sampled in a group correct & fast ->
 *   mark whole group as "probably known" (box 2, due next day) and unlock it.
 */
export function applyPlacementResults(existingFacts, results, fastThresholdMs = 4000, now = Date.now()) {
  const facts = { ...existingFacts };
  const todayStr = toLocalDateString(now);
  const byGroup = {};

  for (const res of results) {
    const { a, b } = parseFactKey(res.key);
    const base = facts[res.key] ? { ...facts[res.key] } : createEmptyFact(res.key);
    const threshold = getFastThresholdMs(a, b, fastThresholdMs);
    const isFast = res.correct && !res.skipped && (res.latencyMs ?? Infinity) <= threshold;

    if (!byGroup[res.groupId]) byGroup[res.groupId] = { total: 0, fastCorrect: 0 };
    byGroup[res.groupId].total += 1;

    if (res.correct && !res.skipped) {
      base.attempts += 1;
      base.correct += 1;
      base.lastSeen = now;
      base.strategyViewed = true;
      base.recentLatenciesMs = [normalizeLatencyMs(res.latencyMs ?? threshold)];
      if (isFast) {
        byGroup[res.groupId].fastCorrect += 1;
        base.box = 3;
        base.due = localMidnightTimestamp(now, 3);
        if (!base.daysCorrectFast.includes(todayStr)) {
          base.daysCorrectFast = [...base.daysCorrectFast, todayStr];
        }
      } else {
        base.box = 2;
        base.due = localMidnightTimestamp(now, 1);
      }
      facts[res.key] = base;
    } else {
      // Wrong or skipped -> unseen/new
      facts[res.key] = createEmptyFact(res.key);
    }
  }

  const unlocked = ['x0x1'];
  for (const grp of TEACHING_GROUPS) {
    const stats = byGroup[grp.id];
    if (stats && stats.total > 0 && stats.fastCorrect / stats.total >= 0.8) {
      if (!unlocked.includes(grp.id)) unlocked.push(grp.id);
      const grpFacts = getFactsIntroducedInGroup(grp.id);
      for (const k of grpFacts) {
        const cur = facts[k] || createEmptyFact(k);
        if (cur.box < 2) {
          facts[k] = {
            ...cur,
            box: 2,
            due: localMidnightTimestamp(now, 1),
            strategyViewed: true
          };
        }
      }
    }
  }

  return {
    facts,
    unlockedGroups: checkGroupUnlocks(facts, unlocked)
  };
}

/**
 * Pick up to 5 trouble facts (lowest accuracy, then slowest median latency)
 * from facts that have been attempted at least once.
 */
export function getTroubleFacts(facts, limit = 5) {
  return ALL_FACT_KEYS
    .map((k) => facts[k])
    .filter((f) => f && f.attempts > 0)
    .map((f) => ({
      key: `${f.a}x${f.b}`,
      fact: f,
      accuracy: f.correct / f.attempts,
      medianMs: median(f.recentLatenciesMs)
    }))
    .sort((a, b) => {
      if (Math.abs(a.accuracy - b.accuracy) > 0.05) return a.accuracy - b.accuracy;
      return b.medianMs - a.medianMs;
    })
    .slice(0, limit);
}

/**
 * Evaluate effort-only badges earned so far.
 */
export function computeBadges(state) {
  const facts = state.facts || {};
  const sessions = state.sessions || [];
  const streakDays = state.streak?.days || 0;
  const bloomCount = ALL_FACT_KEYS.filter((k) => (facts[k]?.box ?? 0) >= 5).length;

  const earned = new Set(state.badges || []);
  if (sessions.length >= 1) earned.add('first_watering');
  if (streakDays >= 3) earned.add('streak_3');
  if (streakDays >= 5) earned.add('streak_5');
  if (bloomCount >= 1) earned.add('first_bloom');
  if (bloomCount >= 10) earned.add('blooms_10');
  if (bloomCount >= 50) earned.add('blooms_50');
  if (bloomCount >= 91) earned.add('all_91');

  // Check if any whole factor table (2..12) is completely in bloom
  for (let n = 2; n <= 12; n++) {
    const tableKeys = getFactsForFactor(n);
    if (tableKeys.every((k) => (facts[k]?.box ?? 0) >= 5)) {
      earned.add(`table_${n}`);
    }
  }

  return [...earned];
}

export const BADGE_LABELS = {
  first_watering: 'First Watering',
  streak_3: '3-Day Garden',
  streak_5: '5 Days in a Row',
  first_bloom: 'First Bloom',
  blooms_10: '10 Blooms',
  blooms_50: '50 Blooms',
  all_91: 'All 91 Blooming!'
};

export function getBadgeLabel(id) {
  if (BADGE_LABELS[id]) return BADGE_LABELS[id];
  if (id.startsWith('table_')) return `×${id.slice(6)} Table Complete`;
  return id;
}
