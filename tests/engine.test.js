import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_FACT_KEYS,
  createEmptyFact,
  factKey,
  getFactsIntroducedInGroup,
  localDaysBetween,
  localMidnightTimestamp,
  toLocalDateString
} from '../facts.js';
import {
  applyPlacementResults,
  buildPlacementQuestions,
  buildSessionQueue,
  checkGroupUnlocks,
  createRng,
  evaluateTrial,
  getFastThresholdMs,
  isTrialFast,
  median,
  normalizeLatencyMs
} from '../engine.js';
import { renderVisual } from '../strategies.js';
import {
  BACKUP_KEY,
  CURRENT_SCHEMA_VERSION,
  STORAGE_KEY,
  createStorage,
  migrateState
} from '../storage.js';

const DAY_MS = 24 * 60 * 60 * 1000;

test('facts: 91 unique commutative fact families for 0..12', () => {
  assert.equal(ALL_FACT_KEYS.length, 91);
  assert.equal(factKey(8, 7), '7x8');
  assert.equal(factKey(7, 8), '7x8');
});

test('latency: 3-digit threshold, typo guard, median-of-3, and idle guard', () => {
  assert.equal(getFastThresholdMs(7, 8, 4000), 4000);
  assert.equal(getFastThresholdMs(10, 10, 4000), 4800);
  assert.equal(getFastThresholdMs(12, 12, 4000), 4800);

  assert.equal(normalizeLatencyMs(25000), 15001);
  assert.equal(median([3100, 2800, 4200]), 3100);

  const fact = { ...createEmptyFact('7x8'), recentLatenciesMs: [5000, 5200] };
  // 3rd trial is fast (3000ms), but median of [5000, 5200, 3000] is 5000 > 4000
  assert.equal(isTrialFast(fact, 3000, 4000), false);

  // If previous two were fast, median of [3000, 3500, 3800] is 3500 <= 4000
  const fastFact = { ...createEmptyFact('7x8'), recentLatenciesMs: [3000, 3500] };
  assert.equal(isTrialFast(fastFact, 3800, 4000), true);

  // Idle guard: paused trial does not record latency or penalize
  const pausedRes = evaluateTrial(fastFact, { correct: true, paused: true, now: 1000000 });
  assert.equal(pausedRes.outcome, 'paused');
  assert.equal(pausedRes.updatedFact.recentLatenciesMs.length, 2);
  assert.equal(pausedRes.updatedFact.box, 0);
});

test('box transitions: wrong answers drop box and schedule re-asks', () => {
  const now = new Date(2026, 10, 13, 10, 0, 0).getTime();
  const rng = createRng(42);

  // Box 0 or 1 -> stays 0
  for (const box of [0, 1]) {
    const f = { ...createEmptyFact('6x7'), box };
    const res = evaluateTrial(f, { correct: false, now }, {}, rng);
    assert.equal(res.outcome, 'wrong');
    assert.equal(res.updatedFact.box, 0);
    assert.equal(res.reaskOffsets.length, 2);
    assert.ok(res.reaskOffsets[0] >= 2 && res.reaskOffsets[0] <= 3);
    assert.ok(res.reaskOffsets[1] >= 5 && res.reaskOffsets[1] <= 7);
    assert.equal(res.reaskAtEnd, true);
  }

  // Box 2 -> drops to 1
  const f2 = { ...createEmptyFact('6x7'), box: 2 };
  assert.equal(evaluateTrial(f2, { correct: false, now }, {}, rng).updatedFact.box, 1);

  // Box 3+ -> drops to 2
  const f4 = { ...createEmptyFact('6x7'), box: 4 };
  assert.equal(evaluateTrial(f4, { correct: false, now }, {}, rng).updatedFact.box, 2);

  // Same-session re-ask cannot promote beyond box 1
  const fReask = { ...createEmptyFact('6x7'), box: 1 };
  const reaskRes = evaluateTrial(fReask, { correct: true, latencyMs: 1500, isSessionReask: true, now }, {}, rng);
  assert.equal(reaskRes.updatedFact.box, 1);
});

test('box transitions: correct-slow, overdue grace, and 3-day mastery rule', () => {
  const day1 = new Date(2026, 10, 10, 15, 0, 0).getTime();
  const day2 = new Date(2026, 10, 11, 9, 0, 0).getTime();
  const day3 = new Date(2026, 10, 12, 9, 0, 0).getTime();
  const rng = createRng(7);

  // Correct but slow: no box change, due in 1 day, retryOffset 6..8
  const slowFact = { ...createEmptyFact('3x4'), box: 3 };
  const slowRes = evaluateTrial(slowFact, { correct: true, latencyMs: 6500, now: day1 }, { fastThresholdMs: 4000 }, rng);
  assert.equal(slowRes.outcome, 'correct-slow');
  assert.equal(slowRes.updatedFact.box, 3);
  assert.equal(slowRes.updatedFact.due, localMidnightTimestamp(day1, 1));
  assert.ok(slowRes.retryOffset >= 6 && slowRes.retryOffset <= 8);

  // 3-day mastery rule: box 4 with only 2 distinct fast days cannot reach box 5
  const almostMastered = {
    ...createEmptyFact('3x4'),
    box: 4,
    daysCorrectFast: [toLocalDateString(day1), toLocalDateString(day2)]
  };
  // Same day (day2) -> still only 2 distinct days -> stays box 4
  const sameDayRes = evaluateTrial(almostMastered, { correct: true, latencyMs: 2000, now: day2 + 3600000 }, {}, rng);
  assert.equal(sameDayRes.updatedFact.box, 4);

  // 3rd distinct day (day3) -> promotes to box 5!
  const thirdDayRes = evaluateTrial(almostMastered, { correct: true, latencyMs: 2000, now: day3 }, {}, rng);
  assert.equal(thirdDayRes.updatedFact.box, 5);
  assert.equal(thirdDayRes.updatedFact.daysCorrectFast.length, 3);

  // Overdue grace: overdue by >2x interval in box 1 does not demote or promote; in box 2 promotes
  const overdueBox1 = {
    ...createEmptyFact('4x5'),
    box: 1,
    lastSeen: day1,
    due: day1 + DAY_MS
  };
  const wayLater = day1 + 5 * DAY_MS;
  const grace1 = evaluateTrial(overdueBox1, { correct: true, latencyMs: 2000, now: wayLater }, {}, rng);
  assert.equal(grace1.updatedFact.box, 1);

  const overdueBox2 = {
    ...createEmptyFact('4x5'),
    box: 2,
    lastSeen: day1,
    due: day1 + DAY_MS
  };
  const grace2 = evaluateTrial(overdueBox2, { correct: true, latencyMs: 2000, now: wayLater }, {}, rng);
  assert.equal(grace2.updatedFact.box, 3);
});

test('calendar days: midnight rollover and backward clock guard', () => {
  const lateNight = new Date(2026, 10, 13, 23, 55, 0).getTime();
  const earlyNextMorning = new Date(2026, 10, 14, 0, 5, 0).getTime();

  const due = localMidnightTimestamp(lateNight, 1);
  assert.ok(due <= earlyNextMorning, 'Fact due next calendar day should be due right after midnight');
  assert.equal(localDaysBetween(lateNight, earlyNextMorning), 1);

  // Backward clock guard
  assert.equal(localDaysBetween(earlyNextMorning, lateNight), 0);
  const f = { ...createEmptyFact('2x3'), box: 1, lastSeen: earlyNextMorning };
  const res = evaluateTrial(f, { correct: true, latencyMs: 2000, now: lateNight }, {}, createRng(1));
  assert.equal(res.updatedFact.lastSeen, earlyNextMorning);
});

test('unlock rule: next group unlocks at >=80% in box >= 3', () => {
  const x0x1Keys = getFactsIntroducedInGroup('x0x1');
  const facts = {};
  for (const k of x0x1Keys) facts[k] = { ...createEmptyFact(k), box: 2 };

  assert.deepEqual(checkGroupUnlocks(facts, ['x0x1']), ['x0x1']);

  // Promote 80% of x0x1 to box 3
  const needed = Math.ceil(x0x1Keys.length * 0.8);
  for (let i = 0; i < needed; i++) {
    facts[x0x1Keys[i]].box = 3;
  }
  assert.deepEqual(checkGroupUnlocks(facts, ['x0x1']), ['x0x1', 'x10x2']);
});

test('queue builder: seeded determinism, constraints, and backlog guard', () => {
  const now = new Date(2026, 10, 13, 10, 0, 0).getTime();
  const facts = {};
  const x0x1Keys = getFactsIntroducedInGroup('x0x1');
  x0x1Keys.forEach((k, idx) => {
    facts[k] = {
      ...createEmptyFact(k),
      box: idx < 10 ? 3 : 0,
      attempts: idx < 10 ? 3 : 0,
      strategyViewed: idx < 10,
      due: idx < 6 ? now - DAY_MS : now + DAY_MS
    };
  });

  const state = {
    settings: { sessionMinutes: 6, newPerSession: 2 },
    facts,
    unlockedGroups: ['x0x1']
  };

  const q1 = buildSessionQueue(state, now, createRng(123));
  const q2 = buildSessionQueue(state, now, createRng(123));
  assert.deepEqual(q1, q2, 'Queue builder must be deterministic with seeded RNG');
  assert.equal(q1[0].kind, 'warmup');
  assert.equal(q1[q1.length - 1].kind, 'cooldown');

  // Verify no non-teach/rehearsal review/fill item repeats within 3 items
  const reviewItems = q1.filter((item) => item.kind === 'review' || item.kind === 'fill');
  for (let i = 0; i < reviewItems.length; i++) {
    for (let j = i + 1; j < Math.min(i + 3, reviewItems.length); j++) {
      assert.notEqual(reviewItems[i].key, reviewItems[j].key, 'Review/fill fact repeated within 3 items');
    }
  }

  // Backlog > 15 blocks new facts
  const bigBacklogFacts = {};
  const x10x2Keys = getFactsIntroducedInGroup('x10x2');
  [...x0x1Keys, ...x10x2Keys].forEach((k, idx) => {
    bigBacklogFacts[k] = {
      ...createEmptyFact(k),
      box: idx < 18 ? 2 : 0,
      attempts: idx < 18 ? 2 : 0,
      strategyViewed: idx < 18,
      due: idx < 18 ? now - DAY_MS : 0
    };
  });
  const backlogQueue = buildSessionQueue(
    { settings: { sessionMinutes: 8, newPerSession: 3 }, facts: bigBacklogFacts, unlockedGroups: ['x0x1', 'x10x2'] },
    now,
    createRng(99)
  );
  assert.equal(backlogQueue.some((i) => i.kind === 'teach'), false, 'New facts must be blocked when due backlog > 15');
});

test('placement check: fast, slow, wrong, skipped, and group-level inference', () => {
  const now = new Date(2026, 10, 13, 10, 0, 0).getTime();
  const questions = buildPlacementQuestions(createRng(1));
  assert.ok(questions.length >= 16 && questions.length <= 20);

  const results = questions.map((q) => {
    if (q.groupId === 'x0x1') {
      return { ...q, correct: true, skipped: false, latencyMs: 1800 };
    }
    if (q.groupId === 'x10x2') {
      return { ...q, correct: true, skipped: false, latencyMs: 6200 };
    }
    return { ...q, correct: false, skipped: true, latencyMs: 0 };
  });

  const { facts, unlockedGroups } = applyPlacementResults({}, results, 4000, now);
  // x0x1 got 100% fast -> unlocked & all its facts at least box 2 (sampled at box 3)
  assert.ok(unlockedGroups.includes('x0x1'));
  const x0x1Sample = results.find((r) => r.groupId === 'x0x1').key;
  assert.equal(facts[x0x1Sample].box, 3);

  // x10x2 was slow -> sampled at box 2
  const x10x2Sample = results.find((r) => r.groupId === 'x10x2').key;
  assert.equal(facts[x10x2Sample].box, 2);
});

test('storage: schema migration, corrupted recovery, and rolling backup', () => {
  const mem = new Map();
  const mockStore = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v))
  };

  const storage = createStorage(mockStore);
  const initial = storage.load();
  assert.equal(initial.schemaVersion, CURRENT_SCHEMA_VERSION);

  initial.profile.name = 'Ada';
  storage.save(initial);
  initial.streak.days = 4;
  storage.save(initial);
  assert.ok(mem.has(BACKUP_KEY));

  // Corrupt primary key -> recovers from rolling backup and backs up corrupt string
  mockStore.setItem(STORAGE_KEY, '{bad json');
  const recovered = storage.load();
  assert.equal(recovered.profile.name, 'Ada');
  const corruptKeys = [...mem.keys()].filter((k) => k.startsWith('factGarden_corrupt_'));
  assert.equal(corruptKeys.length, 1);

  // Migration stub handles missing schemaVersion
  const migrated = migrateState({ profile: { name: 'Leo' } });
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.profile.name, 'Leo');
  assert.deepEqual(migrated.unlockedGroups, ['x0x1']);
});

test('visual renderer: produces valid SVG for all 169 ordered pairs 0..12', () => {
  for (let a = 0; a <= 12; a++) {
    for (let b = 0; b <= 12; b++) {
      const svg = renderVisual({ a, b }, 'auto', { animate: true });
      assert.ok(svg.startsWith('<svg '), `Expected <svg for ${a}x${b}`);
      assert.ok(svg.endsWith('</svg>'), `Expected </svg> for ${a}x${b}`);
      assert.ok(!svg.includes('NaN'), `Unexpected NaN in SVG for ${a}x${b}`);
      assert.ok(!svg.includes('undefined'), `Unexpected undefined in SVG for ${a}x${b}`);
    }
  }
});
