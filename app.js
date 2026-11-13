import {
  ALL_FACT_KEYS,
  TEACHING_GROUPS,
  createEmptyFact,
  factKey,
  getFactCategory,
  getFactsForFactor,
  getFactsIntroducedInGroup,
  getGardenStage,
  localMidnightTimestamp,
  parseFactKey,
  toLocalDateString
} from './facts.js';
import {
  applyPlacementResults,
  buildPlacementQuestions,
  buildSessionQueue,
  checkGroupUnlocks,
  computeBadges,
  createRng,
  evaluateTrial,
  getBadgeLabel,
  getTroubleFacts,
  median
} from './engine.js';
import { getStrategiesForFact, renderVisual } from './strategies.js';
import { createStorage } from './storage.js';
import { playCorrectChime, playGentleHint, playSessionCompleteChime } from './audio.js';

const storage = createStorage();
let state = storage.load();

// Runtime UI state (non-persisted transient state)
let currentScreen = 'home';
let parentUnlocked = false;
let parentTab = 'overview';
let parentGateChallenge = null;
let gardenSelectedKey = null;
let gardenStrategyIndex = 0;
let factsSort = { col: 'fact', dir: 'asc' };

// Active play/mode transient state
let playInput = '';
let playStartTs = 0;
let playHadBackspace = false;
let playIdleTimer = null;
let playPaused = false;
let playFeedback = null; // { type: 'correct'|'wrong', text: string }
let playTeachUnlockTimer = null;
let playTeachReady = false;
let playStrategyIndex = 0;
let playCorrectionInput = '';
let playCorrectionHint = '';
let lastSessionSummary = null;

// Placement transient state
let placementState = null;

// Extra modes transient state
let fixItState = null;
let tourState = null;
let singlePracticeKey = null;

const appEl = document.getElementById('app');

function saveState() {
  state.badges = computeBadges(state);
  storage.save(state);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getGreeting(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}!` : `${part}!`;
}

function getTodayMinutes() {
  const today = toLocalDateString();
  const ms = (state.sessions || [])
    .filter((s) => s.date === today)
    .reduce((sum, s) => sum + Math.max(0, (s.endedAt || 0) - (s.startedAt || 0)), 0);
  const currentMs = state.currentSession && state.currentSession.date === today
    ? Math.max(0, Date.now() - state.currentSession.startedAt)
    : 0;
  return Math.round((ms + currentMs) / 60000);
}

function hasCompletedOfficialSessionToday() {
  const today = toLocalDateString();
  return (state.sessions || []).some((s) => s.date === today && !s.isExtraMode);
}

function renderPlantSvg(stage, { thirsty = false, animate = false, className = '' } = {}) {
  const symbolId = stage === 'unseen' ? 'plant-unseen' : `plant-${stage}`;
  const cls = [
    className,
    thirsty ? 'is-thirsty' : '',
    animate ? 'plant-grow-anim' : ''
  ].filter(Boolean).join(' ');
  return `<svg class="${cls}" viewBox="0 0 40 40" aria-hidden="true"><use href="#${symbolId}"></use></svg>`;
}

function isFactThirsty(fact, now = Date.now()) {
  if (!fact || fact.box < 1 || !fact.due) return false;
  return fact.due < now && toLocalDateString(fact.lastSeen) !== toLocalDateString(now);
}

function updateStreak(now = Date.now()) {
  const today = toLocalDateString(now);
  const yesterday = toLocalDateString(localMidnightTimestamp(now, -1));
  if (state.streak.lastDay === today) return;
  if (state.streak.lastDay === yesterday) {
    state.streak.days += 1;
  } else {
    state.streak.days = 1;
  }
  state.streak.lastDay = today;
}

function clearPlayTimers() {
  if (playIdleTimer) {
    clearTimeout(playIdleTimer);
    playIdleTimer = null;
  }
  if (playTeachUnlockTimer) {
    clearTimeout(playTeachUnlockTimer);
    playTeachUnlockTimer = null;
  }
}

function resetIdleTimer() {
  if (playIdleTimer) clearTimeout(playIdleTimer);
  playPaused = false;
  playIdleTimer = setTimeout(() => {
    if (currentScreen === 'play' && !playFeedback && state.currentSession) {
      playPaused = true;
      render();
    }
  }, 20000);
}

// ============================================================================
// SCREEN ROUTING & RENDERING
// ============================================================================

function navigate(screen) {
  clearPlayTimers();
  currentScreen = screen;
  render();
}

function render() {
  if (!state.profile.name && currentScreen !== 'onboarding') {
    currentScreen = 'onboarding';
  }
  switch (currentScreen) {
    case 'onboarding':
      renderOnboarding();
      break;
    case 'placement':
      renderPlacement();
      break;
    case 'home':
      renderHome();
      break;
    case 'play':
      renderPlay();
      break;
    case 'summary':
      renderSummary();
      break;
    case 'garden':
      renderGarden();
      break;
    case 'parent':
      renderParent();
      break;
    case 'fixit':
      renderFixIt();
      break;
    case 'tour':
      renderTour();
      break;
    case 'single':
      renderSinglePractice();
      break;
    default:
      renderHome();
  }
}

// ============================================================================
// 1. ONBOARDING & PLACEMENT CHECK
// ============================================================================

function renderOnboarding() {
  appEl.innerHTML = `
    <main class="home-main">
      <div class="card" style="max-width:520px;width:100%;text-align:center;">
        <div style="width:64px;height:64px;margin:0 auto 12px;">
          ${renderPlantSvg(5)}
        </div>
        <h1 style="margin:0 0 8px;">Welcome to Fact Garden!</h1>
        <p class="muted" style="margin-bottom:24px;">What is your name?</p>
        <form id="onboard-form" style="display:flex;flex-direction:column;gap:16px;align-items:center;">
          <input id="child-name-input" class="text-input" type="text" maxlength="24" placeholder="Type your name" required style="width:100%;max-width:300px;text-align:center;font-size:24px;" />
          <button type="submit" class="btn btn-primary btn-hero">Start my garden</button>
        </form>
      </div>
    </main>
  `;
  const input = document.getElementById('child-name-input');
  input?.focus();
  document.getElementById('onboard-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    state.profile.name = name;
    state.profile.createdAt = Date.now();
    saveState();
    startPlacementCheck();
  });
}

function startPlacementCheck() {
  placementState = {
    questions: buildPlacementQuestions(createRng(Date.now())),
    index: 0,
    results: [],
    input: '',
    startedAt: Date.now(),
    done: false,
    seedlingCount: 0
  };
  navigate('placement');
}

function renderPlacement() {
  if (!placementState) {
    navigate('home');
    return;
  }
  if (placementState.done) {
    appEl.innerHTML = `
      <main class="home-main">
        <div class="card" style="max-width:540px;width:100%;">
          <div style="width:64px;height:64px;margin:0 auto 12px;">${renderPlantSvg(2, { animate: true })}</div>
          <h1 style="margin:0 0 12px;">Your garden already has ${placementState.seedlingCount} seedlings!</h1>
          <p class="muted" style="margin-bottom:24px;">We'll start right where you're ready and grow from here.</p>
          <button id="placement-done-btn" class="btn btn-primary btn-hero">Go to my garden</button>
        </div>
      </main>
    `;
    document.getElementById('placement-done-btn')?.addEventListener('click', () => {
      placementState = null;
      navigate('home');
    });
    return;
  }

  const q = placementState.questions[placementState.index];
  const pct = Math.round((placementState.index / placementState.questions.length) * 100);
  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="placement-skip-all" class="btn-quiet">Skip check</button>
      <div class="session-bar-wrap">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <span class="muted">${placementState.index + 1} / ${placementState.questions.length}</span>
    </div>
    <main class="play-stage">
      <p class="muted" style="margin:0;">Let's see what you already know. It's okay to skip ones you don't know yet.</p>
      <h1 class="question-text">${q.displayA} × ${q.displayB}</h1>
      <div class="answer-box" id="placement-answer" aria-live="polite">${escapeHtml(placementState.input) || '&nbsp;'}</div>
      <div class="numpad" id="placement-numpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="num-key" data-digit="${d}">${d}</button>`).join('')}
        <button type="button" class="num-key" data-action="back" aria-label="Backspace">⌫</button>
        <button type="button" class="num-key" data-digit="0">0</button>
        <button type="button" class="num-key enter-key" data-action="enter">Enter</button>
      </div>
      <button id="placement-skip-one" class="btn btn-secondary btn-compact-skip">Skip this one</button>
    </main>
  `;

  const submitOne = (skipped = false) => {
    const latencyMs = Date.now() - placementState.startedAt;
    const expected = q.displayA * q.displayB;
    const correct = !skipped && placementState.input !== '' && Number(placementState.input) === expected;
    placementState.results.push({
      key: q.key,
      groupId: q.groupId,
      correct,
      skipped,
      latencyMs
    });
    placementState.index += 1;
    placementState.input = '';
    placementState.startedAt = Date.now();
    if (placementState.index >= placementState.questions.length) {
      finishPlacement();
    } else {
      renderPlacement();
    }
  };

  function finishPlacement() {
    const applied = applyPlacementResults(
      state.facts,
      placementState.results,
      state.settings.fastThresholdMs,
      Date.now()
    );
    state.facts = applied.facts;
    state.unlockedGroups = applied.unlockedGroups;
    state.settings.placementDone = true;
    saveState();
    placementState.seedlingCount = ALL_FACT_KEYS.filter((k) => (state.facts[k]?.box ?? 0) >= 2).length;
    placementState.done = true;
    renderPlacement();
  }

  document.getElementById('placement-numpad')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit !== undefined && placementState.input.length < 3) {
      placementState.input += btn.dataset.digit;
      document.getElementById('placement-answer').textContent = placementState.input;
    } else if (btn.dataset.action === 'back') {
      placementState.input = placementState.input.slice(0, -1);
      document.getElementById('placement-answer').innerHTML = escapeHtml(placementState.input) || '&nbsp;';
    } else if (btn.dataset.action === 'enter' && placementState.input !== '') {
      submitOne(false);
    }
  });

  document.getElementById('placement-skip-one')?.addEventListener('click', () => submitOne(true));
  document.getElementById('placement-skip-all')?.addEventListener('click', () => {
    state.settings.placementDone = true;
    saveState();
    placementState = null;
    navigate('home');
  });
}

// ============================================================================
// 2. HOME SCREEN
// ============================================================================

function renderHome() {
  const hasInProgress = Boolean(state.currentSession && state.currentSession.index < state.currentSession.queue.length);
  const doneToday = hasCompletedOfficialSessionToday();
  const targetMins = state.settings.sessionMinutes || 8;
  const practicedMins = getTodayMinutes();
  const barPct = doneToday ? 100 : Math.min(100, Math.round((practicedMins / targetMins) * 100));

  const mainBtnLabel = hasInProgress ? 'Keep going' : 'Water the garden';
  const statusText = doneToday
    ? 'Garden watered today ✓'
    : `Today: ${practicedMins} of ${targetMins} minutes`;

  const miniCells = [];
  for (let r = 0; r <= 12; r++) {
    for (let c = 0; c <= 12; c++) {
      const k = factKey(r, c);
      const stage = getGardenStage(state.facts[k]);
      const cls = stage === 'unseen' ? 'mini-garden-cell' : `mini-garden-cell s-${stage}`;
      miniCells.push(`<div class="${cls}"></div>`);
    }
  }

  const bloomCount = ALL_FACT_KEYS.filter((k) => (state.facts[k]?.box ?? 0) >= 5).length;

  appEl.innerHTML = `
    <header class="home-header">
      <div class="app-brand">
        <span style="width:32px;height:32px;display:inline-block;">${renderPlantSvg(5)}</span>
        <span>Fact Garden</span>
      </div>
      ${state.streak.days > 0 ? `<div class="streak-pill">🌱 ${state.streak.days} ${state.streak.days === 1 ? 'day' : 'days'} in a row</div>` : ''}
    </header>

    <main class="home-main">
      <h1 class="home-greeting">${escapeHtml(getGreeting(state.profile.name))}</h1>

      ${doneToday && !hasInProgress ? `
        <div class="card" style="background:var(--color-primary-soft);border-color:var(--color-primary);max-width:440px;width:100%;">
          <div style="font-size:26px;font-weight:800;color:var(--color-primary);">Garden watered today ✓</div>
          <p class="muted" style="margin:8px 0 0;">Great job resting your plants until tomorrow!</p>
        </div>
      ` : `
        <button id="home-play-btn" class="btn btn-primary btn-hero">${mainBtnLabel}</button>
      `}

      <div class="today-progress-wrap">
        <div class="muted" style="font-weight:700;">${statusText}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${barPct}%"></div>
        </div>
      </div>

      ${state.settings.softCapEnabled !== false && practicedMins >= 15 ? `
        <div class="card" style="background:var(--color-accent-soft);max-width:460px;width:100%;padding:12px 18px;">
          <strong>Great work! Time for a break.</strong>
          <div class="muted">You've practiced ${practicedMins} minutes today.</div>
        </div>
      ` : ''}

      <div class="home-garden-row">
        <div class="mini-garden-grid" aria-hidden="true">${miniCells.join('')}</div>
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:12px;">
          <div class="muted"><strong>${bloomCount}</strong> of 91 facts blooming</div>
          <button id="home-garden-btn" class="btn btn-secondary">My garden</button>
        </div>
      </div>

      <div style="margin-top:8px;">
        <div class="muted" style="margin-bottom:8px;">More ways to practice</div>
        <div class="home-extra-modes">
          <button id="mode-fixit-btn" class="btn btn-secondary" style="min-height:48px;font-size:18px;">Fix-it practice</button>
          <button id="mode-tour-btn" class="btn btn-secondary" style="min-height:48px;font-size:18px;">Table tour</button>
        </div>
      </div>
    </main>

    <footer class="home-footer">
      <button id="home-parent-btn" class="btn-quiet" aria-label="Parent settings">⚙ Parent</button>
    </footer>
  `;

  document.getElementById('home-play-btn')?.addEventListener('click', startOrResumeSession);
  document.getElementById('home-garden-btn')?.addEventListener('click', () => navigate('garden'));
  document.getElementById('mode-fixit-btn')?.addEventListener('click', startFixItMode);
  document.getElementById('mode-tour-btn')?.addEventListener('click', startTourMode);
  document.getElementById('home-parent-btn')?.addEventListener('click', () => {
    parentUnlocked = false;
    parentGateChallenge = null;
    navigate('parent');
  });
}

// ============================================================================
// 3. PLAY, TEACH CARD, AND CORRECTION VIEW
// ============================================================================

function startOrResumeSession() {
  if (!state.currentSession || state.currentSession.index >= state.currentSession.queue.length) {
    const now = Date.now();
    const queue = buildSessionQueue(state, now);
    state.currentSession = {
      date: toLocalDateString(now),
      startedAt: now,
      queue,
      index: 0,
      questionsAnswered: 0,
      correctCount: 0,
      newFactsCount: 0,
      errorsCount: 0,
      recentOutcomes: [], // last 8 booleans for success-ratio guard
      guardTriggered: false,
      newFactsPaused: false,
      gotFasterKeys: [],
      bloomedKeys: [],
      correctKeysThisSession: [],
      correctionPending: null // { key, displayA, displayB }
    };
    saveState();
  }
  playInput = '';
  playFeedback = null;
  playPaused = false;
  playStartTs = Date.now();
  playHadBackspace = false;
  navigate('play');
}

function getDisplayQuestion(item) {
  const { displayA, displayB, mode } = item;
  const prod = displayA * displayB;
  if (mode === 'inverse') {
    return { prompt: `${displayA} × ? = ${prod}`, expected: displayB };
  }
  if (mode === 'division') {
    return { prompt: `${prod} ÷ ${displayA} = ?`, expected: displayB };
  }
  return { prompt: `${displayA} × ${displayB}`, expected: prod };
}

function maybeAssignExtraMode(item) {
  const fact = state.facts[item.key];
  if (!fact || item.kind === 'teach' || item.isSessionReask) return item;
  if (state.settings.divisionMode && fact.box >= 4 && item.displayA > 0 && Math.random() < 0.25) {
    return { ...item, mode: 'division', halfWeight: true };
  }
  if (state.settings.inverseMode && fact.box >= 3 && Math.random() < 0.25) {
    return { ...item, mode: 'inverse', halfWeight: true };
  }
  return item;
}

function renderPlay() {
  const session = state.currentSession;
  if (!session) {
    navigate('home');
    return;
  }

  // Check if session finished
  if (!session.correctionPending && session.index >= session.queue.length) {
    completeSession();
    return;
  }

  // Correction view after wrong answer
  if (session.correctionPending) {
    renderCorrectionView(session.correctionPending);
    return;
  }

  const item = session.queue[session.index];

  // Teach card for new facts
  if (item.kind === 'teach') {
    renderTeachCard(item);
    return;
  }

  const pct = Math.min(100, Math.round((session.index / Math.max(1, session.queue.length)) * 100));
  const fact = state.facts[item.key] || createEmptyFact(item.key);
  const stage = getGardenStage(fact);
  const { prompt } = getDisplayQuestion(item);

  const boxStateClass = playFeedback?.type === 'correct'
    ? 'state-correct'
    : playFeedback?.type === 'wrong'
      ? 'state-wrong'
      : '';

  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="play-exit-btn" class="btn-quiet">Save and exit</button>
      <div class="session-bar-wrap">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <button id="play-sound-btn" class="btn-quiet" aria-label="Toggle sound">${state.settings.sound ? '🔊' : '🔇'}</button>
    </div>

    <main class="play-stage">
      ${playPaused ? `<div class="feedback-banner positive">Take your time. Press any key when ready.</div>` : ''}
      <div class="question-row">
        <h1 class="question-text">${escapeHtml(prompt)}</h1>
        <div class="question-plant">${renderPlantSvg(stage, { animate: playFeedback?.type === 'correct' })}</div>
      </div>

      <div id="play-answer-box" class="answer-box ${boxStateClass}" aria-live="polite">
        ${escapeHtml(playInput) || '&nbsp;'}
      </div>

      <div class="feedback-banner ${playFeedback?.type === 'wrong' ? 'calm-blue' : 'positive'}">
        ${playFeedback ? escapeHtml(playFeedback.text) : '&nbsp;'}
      </div>

      <div class="numpad" id="play-numpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="num-key" data-digit="${d}">${d}</button>`).join('')}
        <button type="button" class="num-key" data-action="back" aria-label="Backspace">⌫</button>
        <button type="button" class="num-key" data-digit="0">0</button>
        <button type="button" class="num-key enter-key" data-action="enter">Enter</button>
      </div>
    </main>
  `;

  if (!playFeedback && !playPaused) {
    resetIdleTimer();
  }

  document.getElementById('play-exit-btn')?.addEventListener('click', () => {
    saveState();
    navigate('home');
  });

  document.getElementById('play-sound-btn')?.addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    saveState();
    renderPlay();
  });

  document.getElementById('play-numpad')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || playFeedback) return;
    if (playPaused) {
      playPaused = false;
      playStartTs = Date.now();
    }
    resetIdleTimer();

    if (btn.dataset.digit !== undefined && playInput.length < 3) {
      playInput += btn.dataset.digit;
      renderPlay();
    } else if (btn.dataset.action === 'back') {
      playHadBackspace = true;
      playInput = playInput.slice(0, -1);
      renderPlay();
    } else if (btn.dataset.action === 'enter' && playInput !== '') {
      submitPlayAnswer();
    }
  });
}

function submitPlayAnswer() {
  const session = state.currentSession;
  if (!session || playFeedback) return;
  clearPlayTimers();

  const item = session.queue[session.index];
  const { expected } = getDisplayQuestion(item);
  const userAns = Number(playInput);
  const correct = userAns === expected;
  const now = Date.now();
  const latencyMs = now - playStartTs;

  const existing = state.facts[item.key] || createEmptyFact(item.key);
  const prevBox = existing.box;
  const prevMedian = median(existing.recentLatenciesMs);

  const evalRes = evaluateTrial(existing, {
    correct,
    latencyMs,
    paused: playPaused,
    isSessionReask: item.isSessionReask,
    halfWeight: Boolean(item.halfWeight),
    now
  }, state.settings);

  state.facts[item.key] = evalRes.updatedFact;
  state.unlockedGroups = checkGroupUnlocks(state.facts, state.unlockedGroups, state.settings.unlockOverride);

  session.questionsAnswered += 1;
  session.recentOutcomes.push(correct);
  if (session.recentOutcomes.length > 8) {
    session.recentOutcomes = session.recentOutcomes.slice(-8);
  }

  if (correct) {
    session.correctCount += 1;
    if (!session.correctKeysThisSession.includes(item.key)) {
      session.correctKeysThisSession.push(item.key);
    }
    if (evalRes.updatedFact.box > prevBox && evalRes.updatedFact.box === 5 && !session.bloomedKeys.includes(item.key)) {
      session.bloomedKeys.push(item.key);
    }
    const newMedian = median(evalRes.updatedFact.recentLatenciesMs);
    if (prevMedian > 0 && newMedian < prevMedian - 200 && !session.gotFasterKeys.includes(item.key)) {
      session.gotFasterKeys.push(item.key);
    }

    // Slow-correct in-session retry after 6-8 items
    if (evalRes.outcome === 'correct-slow' && evalRes.retryOffset) {
      const insertAt = Math.min(session.queue.length - 2, session.index + evalRes.retryOffset);
      session.queue.splice(Math.max(session.index + 1, insertAt), 0, {
        key: item.key,
        displayA: item.displayB,
        displayB: item.displayA,
        kind: 'retry',
        isSessionReask: true
      });
    }

    // Update cool-down items near end with facts answered correctly earlier
    if (session.correctKeysThisSession.length >= 2) {
      const tailLen = session.queue.length;
      if (tailLen >= 2 && session.index < tailLen - 2) {
        const c1 = session.correctKeysThisSession[0];
        const c2 = session.correctKeysThisSession[1];
        if (session.queue[tailLen - 2].kind === 'cooldown') {
          const p1 = parseFactKey(c1);
          session.queue[tailLen - 2] = { key: c1, displayA: p1.a, displayB: p1.b, kind: 'cooldown', isSessionReask: false };
        }
        if (session.queue[tailLen - 1].kind === 'cooldown') {
          const p2 = parseFactKey(c2);
          session.queue[tailLen - 1] = { key: c2, displayA: p2.a, displayB: p2.b, kind: 'cooldown', isSessionReask: false };
        }
      }
    }

    playCorrectChime(state.settings.sound);
    const praises = ['Nice work!', 'You got it!', 'Growing strong!', 'Steady and sure!'];
    playFeedback = {
      type: 'correct',
      text: evalRes.outcome === 'correct-fast' ? praises[session.questionsAnswered % praises.length] : 'You got it!'
    };
    saveState();
    renderPlay();

    setTimeout(() => {
      playFeedback = null;
      playInput = '';
      session.index += 1;
      if (session.index < session.queue.length) {
        session.queue[session.index] = maybeAssignExtraMode(session.queue[session.index]);
      }
      playStartTs = Date.now();
      playHadBackspace = false;
      saveState();
      renderPlay();
    }, 600);
  } else {
    // Wrong answer: calm blue message -> Correction view -> re-ask
    session.errorsCount += 1;
    playGentleHint(state.settings.sound);

    // Schedule re-asks at +2..3, +5..7, and session end
    const [g1, g2] = evalRes.reaskOffsets;
    const pos1 = Math.min(session.queue.length, session.index + 1 + g1);
    session.queue.splice(pos1, 0, {
      key: item.key,
      displayA: item.displayA,
      displayB: item.displayB,
      kind: 'reask',
      isSessionReask: true
    });
    const pos2 = Math.min(session.queue.length, session.index + 1 + g2 + 1);
    session.queue.splice(pos2, 0, {
      key: item.key,
      displayA: item.displayB,
      displayB: item.displayA,
      kind: 'reask',
      isSessionReask: true
    });
    session.queue.push({
      key: item.key,
      displayA: item.displayA,
      displayB: item.displayB,
      kind: 'reask',
      isSessionReask: true
    });

    // Success ratio guard: if accuracy over last 8 trials < 70%, insert 2 easy known facts & pause new facts
    if (!session.guardTriggered && session.recentOutcomes.length >= 8) {
      const acc = session.recentOutcomes.filter(Boolean).length / session.recentOutcomes.length;
      if (acc < 0.7) {
        session.guardTriggered = true;
        session.newFactsPaused = true;
        // Remove upcoming teach/rehearsal items
        const head = session.queue.slice(0, session.index + 1);
        const tail = session.queue.slice(session.index + 1).filter((q) => q.kind !== 'teach' && q.kind !== 'rehearsal');
        const easyPool = ALL_FACT_KEYS.filter((k) => (state.facts[k]?.box ?? 0) >= 3);
        const inserts = easyPool.slice(0, 2).map((k) => {
          const p = parseFactKey(k);
          return { key: k, displayA: p.a, displayB: p.b, kind: 'fill', isSessionReask: false };
        });
        session.queue = [...head, ...inserts, ...tail];
      }
    }

    playFeedback = { type: 'wrong', text: "Not quite. Let's look at it together." };
    saveState();
    renderPlay();

    setTimeout(() => {
      playFeedback = null;
      playInput = '';
      playCorrectionInput = '';
      playCorrectionHint = '';
      playStrategyIndex = 0;
      session.correctionPending = {
        key: item.key,
        displayA: item.displayA,
        displayB: item.displayB
      };
      saveState();
      renderPlay();
    }, 900);
  }
}

function renderTeachCard(item) {
  const { displayA, displayB, key } = item;
  const strategies = getStrategiesForFact(displayA, displayB);
  const strat = strategies[playStrategyIndex % strategies.length];
  const visualSvg = renderVisual({ a: displayA, b: displayB }, strat.visualType, { animate: true });

  if (!playTeachReady && !playTeachUnlockTimer) {
    playTeachUnlockTimer = setTimeout(() => {
      playTeachReady = true;
      const btn = document.getElementById('teach-gotit-btn');
      if (btn) btn.disabled = false;
    }, 2000);
  }

  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="play-exit-btn" class="btn-quiet">Save and exit</button>
      <span class="muted">New plant in your garden!</span>
      <span></span>
    </div>

    <main class="teach-grid card">
      <div class="visual-panel">${visualSvg}</div>
      <div class="teach-info">
        <h1 class="teach-equation">${displayA} × ${displayB} = ${displayA * displayB}</h1>
        <p class="strategy-sentence">${escapeHtml(strat.text)}</p>
        ${strategies.length > 1 ? `<button id="teach-another-btn" class="btn-quiet">Show me another way</button>` : ''}
        <button id="teach-gotit-btn" class="btn btn-primary btn-timed-fill" ${playTeachReady ? '' : 'disabled'}>
          <span class="fill-bar"></span>
          <span style="position:relative;z-index:1;">Got it</span>
        </button>
      </div>
    </main>
  `;

  document.getElementById('play-exit-btn')?.addEventListener('click', () => {
    saveState();
    navigate('home');
  });

  document.getElementById('teach-another-btn')?.addEventListener('click', () => {
    playStrategyIndex = (playStrategyIndex + 1) % strategies.length;
    renderTeachCard(item);
  });

  document.getElementById('teach-gotit-btn')?.addEventListener('click', () => {
    clearPlayTimers();
    playTeachReady = false;
    playStrategyIndex = 0;
    const fact = state.facts[key] || createEmptyFact(key);
    fact.strategyViewed = true;
    state.facts[key] = fact;
    state.currentSession.newFactsCount += 1;
    state.currentSession.index += 1;
    playStartTs = Date.now();
    saveState();
    renderPlay();
  });
}

function renderCorrectionView(corr) {
  const { displayA, displayB } = corr;
  const expected = displayA * displayB;
  const strategies = getStrategiesForFact(displayA, displayB);
  const strat = strategies[playStrategyIndex % strategies.length];
  const visualSvg = renderVisual({ a: displayA, b: displayB }, strat.visualType, { animate: false });

  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="play-exit-btn" class="btn-quiet">Save and exit</button>
      <span class="muted">Let's practice this one together</span>
      <span></span>
    </div>

    <main class="teach-grid card">
      <div class="visual-panel">${visualSvg}</div>
      <div class="teach-info">
        <h1 class="teach-equation">${displayA} × ${displayB} = ${expected}</h1>
        <p class="strategy-sentence">${escapeHtml(strat.text)}</p>
        ${strategies.length > 1 ? `<button id="corr-another-btn" class="btn-quiet">Show me another way</button>` : ''}
        <label style="font-weight:700;">Type the answer to remember it:</label>
        <div class="answer-box" style="width:180px;min-height:72px;font-size:52px;">${escapeHtml(playCorrectionInput) || '&nbsp;'}</div>
        <div class="feedback-banner calm-blue" style="text-align:left;">${escapeHtml(playCorrectionHint) || '&nbsp;'}</div>
        <div class="numpad" id="corr-numpad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="num-key" data-digit="${d}">${d}</button>`).join('')}
          <button type="button" class="num-key" data-action="back" aria-label="Backspace">⌫</button>
          <button type="button" class="num-key" data-digit="0">0</button>
          <button type="button" class="num-key enter-key" data-action="enter">Enter</button>
        </div>
      </div>
    </main>
  `;

  document.getElementById('play-exit-btn')?.addEventListener('click', () => {
    saveState();
    navigate('home');
  });

  document.getElementById('corr-another-btn')?.addEventListener('click', () => {
    playStrategyIndex = (playStrategyIndex + 1) % strategies.length;
    renderCorrectionView(corr);
  });

  document.getElementById('corr-numpad')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit !== undefined && playCorrectionInput.length < 3) {
      playCorrectionInput += btn.dataset.digit;
      renderCorrectionView(corr);
    } else if (btn.dataset.action === 'back') {
      playCorrectionInput = playCorrectionInput.slice(0, -1);
      renderCorrectionView(corr);
    } else if (btn.dataset.action === 'enter' && playCorrectionInput !== '') {
      submitCorrectionAnswer();
    }
  });
}

function submitCorrectionAnswer() {
  const session = state.currentSession;
  if (!session?.correctionPending) return;
  const { displayA, displayB } = session.correctionPending;
  const expected = displayA * displayB;
  if (Number(playCorrectionInput) === expected) {
    session.correctionPending = null;
    session.index += 1;
    playCorrectionInput = '';
    playCorrectionHint = '';
    playStartTs = Date.now();
    saveState();
    renderPlay();
  } else {
    playCorrectionInput = '';
    playCorrectionHint = 'Look at the answer above';
    renderCorrectionView(session.correctionPending);
  }
}

function completeSession() {
  const session = state.currentSession;
  const now = Date.now();
  const record = {
    date: session.date,
    startedAt: session.startedAt,
    endedAt: now,
    questions: session.questionsAnswered,
    correct: session.correctCount,
    newFacts: session.newFactsCount,
    errors: session.errorsCount
  };
  state.sessions.push(record);
  updateStreak(now);

  const tomorrowEnd = localMidnightTimestamp(now, 2) - 1;
  const dueTomorrow = ALL_FACT_KEYS
    .filter((k) => {
      const f = state.facts[k];
      return f && f.box >= 1 && f.due > 0 && f.due <= tomorrowEnd;
    })
    .slice(0, 4)
    .map((k) => k.replace('x', ' × '));

  lastSessionSummary = {
    practiced: session.questionsAnswered,
    gotRight: session.correctCount,
    gettingQuicker: session.gotFasterKeys.length,
    bloomed: [...session.bloomedKeys],
    dueTomorrow
  };

  state.currentSession = null;
  saveState();
  playSessionCompleteChime(state.settings.sound);
  navigate('summary');
}

// ============================================================================
// 4. SESSION SUMMARY
// ============================================================================

function renderSummary() {
  const sum = lastSessionSummary || { practiced: 0, gotRight: 0, gettingQuicker: 0, bloomed: [], dueTomorrow: [] };
  appEl.innerHTML = `
    <main class="summary-wrap">
      <div style="font-size:40px;" aria-hidden="true">✨</div>
      <h1 style="margin:0;font-size:40px;">Garden watered!</h1>

      <div class="summary-cards">
        <div class="stat-card">
          <div class="stat-value">${sum.practiced}</div>
          <div class="muted">Facts practiced</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${sum.gotRight}</div>
          <div class="muted">Got right</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${sum.gettingQuicker}</div>
          <div class="muted">Getting quicker</div>
        </div>
      </div>

      ${sum.bloomed.length > 0 ? `
        <div class="card">
          <h2 style="margin-top:0;">New blooms!</h2>
          <div class="bloomed-list">
            ${sum.bloomed.map((k) => `
              <div class="bloomed-chip">
                <span style="width:28px;height:28px;display:inline-block;">${renderPlantSvg(5, { animate: true })}</span>
                <span>${k.replace('x', ' × ')} is blooming!</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${sum.dueTomorrow.length > 0 ? `
        <p class="muted" style="font-size:18px;">Tomorrow we'll visit: <strong>${escapeHtml(sum.dueTomorrow.join(', '))}</strong></p>
      ` : ''}

      <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:8px;">
        <button id="summary-garden-btn" class="btn btn-secondary">See my garden</button>
        <button id="summary-done-btn" class="btn btn-primary">Done</button>
      </div>
    </main>
  `;

  document.getElementById('summary-garden-btn')?.addEventListener('click', () => navigate('garden'));
  document.getElementById('summary-done-btn')?.addEventListener('click', () => navigate('home'));
}

// ============================================================================
// 5. MY GARDEN (PROGRESS)
// ============================================================================

function renderGarden() {
  const now = Date.now();
  const bloomCount = ALL_FACT_KEYS.filter((k) => (state.facts[k]?.box ?? 0) >= 5).length;
  const gardenTheme = state.settings.garden !== false;

  let gridHtml = `<div class="garden-axis">×</div>`;
  for (let c = 0; c <= 12; c++) {
    gridHtml += `<div class="garden-axis">${c}</div>`;
  }
  for (let r = 0; r <= 12; r++) {
    gridHtml += `<div class="garden-axis">${r}</div>`;
    for (let c = 0; c <= 12; c++) {
      const k = factKey(r, c);
      const fact = state.facts[k];
      const stage = getGardenStage(fact);
      const thirsty = isFactThirsty(fact, now);
      const title = thirsty ? 'This one is ready to be watered.' : `${r} × ${c}`;
      const cellContent = gardenTheme
        ? renderPlantSvg(stage, { thirsty })
        : `<div class="plain-square ${stage === 'unseen' ? '' : `s-${stage}`}"></div>`;

      gridHtml += `
        <button type="button" class="garden-cell ${r === c ? 'is-square' : ''}" data-key="${k}" data-a="${r}" data-b="${c}" title="${escapeHtml(title)}" aria-label="${r} times ${c}">
          ${cellContent}
        </button>
      `;
    }
  }

  const allBadgeIds = [
    'first_watering', 'streak_3', 'streak_5', 'first_bloom', 'blooms_10', 'blooms_50', 'all_91',
    ...(state.badges || []).filter((b) => b.startsWith('table_'))
  ];

  appEl.innerHTML = `
    <div class="garden-header">
      <button id="garden-back-btn" class="btn btn-secondary" style="min-height:44px;font-size:18px;">← Home</button>
      <h1 style="margin:0;">My Garden</h1>
      <div class="muted"><strong>${bloomCount} of 91</strong> facts blooming</div>
    </div>

    <div class="garden-legend">
      ${[
        ['unseen', 'Empty soil'],
        [0, 'Seed'],
        [1, 'Sprout'],
        [2, 'Seedling'],
        [3, 'Growing'],
        [4, 'Budding'],
        [5, 'Bloom']
      ].map(([s, label]) => `
        <span class="legend-item">
          <span style="width:24px;height:24px;display:inline-block;">${renderPlantSvg(s)}</span>
          <span>${label}</span>
        </span>
      `).join('')}
    </div>

    <div class="card garden-grid-scroll">
      <div class="garden-grid" id="garden-grid">${gridHtml}</div>
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin:0 0 12px;">How my garden has grown</h2>
      ${renderGrowthLineChart()}
    </div>

    <div class="card" style="margin-top:24px;">
      <h2 style="margin:0 0 8px;">Garden Badges</h2>
      <div class="badges-row">
        ${allBadgeIds.map((id) => {
          const has = (state.badges || []).includes(id);
          return `<span class="badge-pill ${has ? '' : 'locked'}">${has ? '🌟 ' : ''}${escapeHtml(getBadgeLabel(id))}</span>`;
        }).join('')}
      </div>
    </div>

    ${gardenSelectedKey ? renderGardenDetailModal(gardenSelectedKey) : ''}
  `;

  document.getElementById('garden-back-btn')?.addEventListener('click', () => {
    gardenSelectedKey = null;
    navigate('home');
  });

  document.getElementById('garden-grid')?.addEventListener('click', (e) => {
    const cell = e.target.closest('.garden-cell');
    if (!cell) return;
    gardenSelectedKey = cell.dataset.key;
    gardenStrategyIndex = 0;
    renderGarden();
  });

  if (gardenSelectedKey) {
    document.getElementById('modal-close-btn')?.addEventListener('click', () => {
      gardenSelectedKey = null;
      renderGarden();
    });
    document.getElementById('modal-another-btn')?.addEventListener('click', () => {
      gardenStrategyIndex += 1;
      renderGarden();
    });
    document.getElementById('modal-practice-btn')?.addEventListener('click', () => {
      singlePracticeKey = gardenSelectedKey;
      gardenSelectedKey = null;
      playInput = '';
      playFeedback = null;
      playStartTs = Date.now();
      navigate('single');
    });
  }
}

function renderGardenDetailModal(key) {
  const { a, b } = parseFactKey(key);
  const fact = state.facts[key] || createEmptyFact(key);
  const stage = getGardenStage(fact);
  const stageNames = {
    unseen: 'Empty soil', 0: 'Seed', 1: 'Sprout', 2: 'Seedling', 3: 'Growing', 4: 'Budding', 5: 'Bloom'
  };
  const strategies = getStrategiesForFact(a, b);
  const strat = strategies[gardenStrategyIndex % strategies.length];
  const fastest = fact.recentLatenciesMs.length > 0
    ? (Math.min(...fact.recentLatenciesMs) / 1000).toFixed(1)
    : null;

  return `
    <div class="modal-backdrop">
      <div class="card modal-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">${a} × ${b} = ${a * b}</h2>
          <button id="modal-close-btn" class="btn-quiet">✕ Close</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin:12px 0;">
          <span style="width:40px;height:40px;display:inline-block;">${renderPlantSvg(stage)}</span>
          <strong>Stage: ${stageNames[stage]}</strong>
        </div>
        <p class="muted">
          ${fact.attempts > 0
            ? `You've practiced this ${fact.attempts} ${fact.attempts === 1 ? 'time' : 'times'}.${fastest ? ` Your fastest was ${fastest} seconds.` : ''}`
            : "You haven't watered this plant yet."}
        </p>
        <div class="visual-panel" style="margin:12px 0;">
          ${renderVisual({ a, b }, strat.visualType)}
        </div>
        <p>${escapeHtml(strat.text)}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
          ${strategies.length > 1 ? `<button id="modal-another-btn" class="btn btn-secondary" style="min-height:44px;font-size:16px;">Show me another way</button>` : ''}
          <button id="modal-practice-btn" class="btn btn-primary" style="min-height:44px;font-size:18px;">Practice this one</button>
        </div>
      </div>
    </div>
  `;
}

function renderGrowthLineChart() {
  const strongCount = ALL_FACT_KEYS.filter((k) => (state.facts[k]?.box ?? 0) >= 4).length;
  const sessions = state.sessions || [];
  const points = sessions.length > 0
    ? sessions.slice(-14).map((s, idx) => ({
        date: s.date,
        value: Math.round((strongCount * (idx + 1)) / Math.min(14, sessions.length))
      }))
    : [{ date: toLocalDateString(), value: strongCount }];

  const w = 600;
  const h = 160;
  const padX = 40;
  const padY = 24;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const coords = points.map((p, i) => {
    const x = points.length === 1 ? padX + plotW / 2 : padX + (i / (points.length - 1)) * plotW;
    const y = padY + plotH - (p.value / 91) * plotH;
    return { x, y, ...p };
  });

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];

  return `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:600px;height:auto;" role="img" aria-label="Growth chart of strong and blooming facts">
      <line x1="${padX}" y1="${padY + plotH}" x2="${w - padX}" y2="${padY + plotH}" stroke="var(--color-border)" stroke-width="2" />
      ${coords.length > 1 ? `<polyline fill="none" stroke="var(--color-primary)" stroke-width="3" points="${polyline}" />` : ''}
      ${coords.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="var(--color-primary)" />`).join('')}
      <text x="${first.x.toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="12" fill="var(--color-muted)">${first.date}</text>
      ${coords.length > 1 ? `<text x="${last.x.toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="12" fill="var(--color-muted)">${last.date}</text>` : ''}
      <text x="${last.x.toFixed(1)}" y="${Math.max(14, last.y - 10).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--color-primary)">${last.value}</text>
    </svg>
  `;
}

// ============================================================================
// 6. PARENT AREA
// ============================================================================

function renderParent() {
  if (!parentUnlocked) {
    if (!parentGateChallenge) {
      if (state.settings.pinOrQuestion === 'pin' && state.settings.pinCode) {
        parentGateChallenge = { type: 'pin', answer: state.settings.pinCode, prompt: 'Enter your 4-digit parent PIN:' };
      } else {
        const a = 12 + Math.floor(Math.random() * 6);
        const b = 6 + Math.floor(Math.random() * 6);
        parentGateChallenge = { type: 'question', answer: String(a * b), prompt: `Parent check: What is ${a} × ${b}?` };
      }
    }

    appEl.innerHTML = `
      <div class="play-topbar">
        <button id="parent-back-btn" class="btn btn-secondary" style="min-height:44px;font-size:18px;">← Back</button>
        <span></span><span></span>
      </div>
      <main class="home-main">
        <div class="card" style="max-width:440px;width:100%;">
          <h1 style="margin-top:0;">Parent Area</h1>
          <p>${escapeHtml(parentGateChallenge.prompt)}</p>
          <form id="parent-gate-form" style="display:flex;flex-direction:column;gap:12px;">
            <input id="parent-gate-input" class="text-input" type="${parentGateChallenge.type === 'pin' ? 'password' : 'number'}" autocomplete="off" required />
            <div id="parent-gate-err" class="muted"></div>
            <button type="submit" class="btn btn-primary">Enter</button>
          </form>
        </div>
      </main>
    `;
    document.getElementById('parent-back-btn')?.addEventListener('click', () => navigate('home'));
    document.getElementById('parent-gate-input')?.focus();
    document.getElementById('parent-gate-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('parent-gate-input').value.trim();
      if (val === parentGateChallenge.answer) {
        parentUnlocked = true;
        renderParent();
      } else {
        document.getElementById('parent-gate-err').textContent = 'Not quite — try again.';
      }
    });
    return;
  }

  appEl.innerHTML = `
    <div class="garden-header">
      <button id="parent-home-btn" class="btn btn-secondary" style="min-height:44px;font-size:18px;">← Home</button>
      <h1 style="margin:0;">Parent Dashboard</h1>
      <span class="muted">Last saved: ${state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleTimeString() : 'Never'}</span>
    </div>

    <div class="tabs">
      ${['overview', 'facts', 'sessions', 'settings'].map((t) => `
        <button class="tab-btn ${parentTab === t ? 'active' : ''}" data-tab="${t}">
          ${t[0].toUpperCase() + t.slice(1)}
        </button>
      `).join('')}
    </div>

    <div id="parent-tab-body"></div>
  `;

  document.getElementById('parent-home-btn')?.addEventListener('click', () => navigate('home'));
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      parentTab = btn.dataset.tab;
      renderParent();
    });
  });

  const body = document.getElementById('parent-tab-body');
  if (parentTab === 'overview') renderParentOverview(body);
  else if (parentTab === 'facts') renderParentFacts(body);
  else if (parentTab === 'sessions') renderParentSessions(body);
  else renderParentSettings(body);
}

function renderParentOverview(container) {
  const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
  for (const k of ALL_FACT_KEYS) counts[getFactCategory(state.facts[k])] += 1;
  const sessions = state.sessions || [];
  const avgMins = sessions.length > 0
    ? (sessions.reduce((s, x) => s + Math.max(0, x.endedAt - x.startedAt), 0) / sessions.length / 60000).toFixed(1)
    : '0.0';
  const trouble = getTroubleFacts(state.facts, 5);

  // Recommend factor needing most work
  let recText = 'Keep up the steady daily watering!';
  if (trouble.length > 0) {
    const factors = [...new Set(trouble.slice(0, 2).map((t) => `×${t.fact.b}`))];
    recText = `Most work needed: ${factors.join(' and ')}.`;
  }

  container.innerHTML = `
    <div style="display:grid;gap:24px;">
      <div class="card">
        <h2 style="margin-top:0;">Facts by State (91 total)</h2>
        <div style="display:flex;height:24px;border-radius:999px;overflow:hidden;border:1px solid var(--color-border);">
          <div style="width:${(counts.mastered / 91) * 100}%;background:var(--color-stage-bloom);" title="Mastered: ${counts.mastered}"></div>
          <div style="width:${(counts.review / 91) * 100}%;background:var(--color-stage-growing);" title="Review: ${counts.review}"></div>
          <div style="width:${(counts.learning / 91) * 100}%;background:var(--color-stage-sprout);" title="Learning: ${counts.learning}"></div>
          <div style="width:${(counts.new / 91) * 100}%;background:var(--color-border);" title="New: ${counts.new}"></div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:16px;">
          <span>Mastered: <strong>${counts.mastered}</strong></span>
          <span>Solid/Review: <strong>${counts.review}</strong></span>
          <span>Learning: <strong>${counts.learning}</strong></span>
          <span>New: <strong>${counts.new}</strong></span>
          <span>Avg session: <strong>${avgMins} min</strong></span>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0;">Trouble Facts</h2>
        <p class="muted">${escapeHtml(recText)}</p>
        ${trouble.length === 0 ? '<p class="muted">No trouble facts yet.</p>' : `
          <table class="data-table">
            <thead><tr><th>Fact</th><th>Accuracy</th><th>Median Time</th><th>Box</th></tr></thead>
            <tbody>
              ${trouble.map((t) => `
                <tr>
                  <td>${t.fact.a} × ${t.fact.b}</td>
                  <td>${Math.round(t.accuracy * 100)}%</td>
                  <td>${t.medianMs ? (t.medianMs / 1000).toFixed(1) + 's' : '—'}</td>
                  <td>${t.fact.box}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    </div>
  `;
}

function renderParentFacts(container) {
  const rows = ALL_FACT_KEYS.map((k) => {
    const f = state.facts[k] || createEmptyFact(k);
    const acc = f.attempts > 0 ? Math.round((f.correct / f.attempts) * 100) : -1;
    const med = f.recentLatenciesMs.length > 0 ? median(f.recentLatenciesMs) : -1;
    return { key: k, f, stateLabel: getFactCategory(f), acc, med };
  });

  rows.sort((a, b) => {
    const dir = factsSort.dir === 'asc' ? 1 : -1;
    switch (factsSort.col) {
      case 'box': return (a.f.box - b.f.box) * dir;
      case 'acc': return (a.acc - b.acc) * dir;
      case 'med': return (a.med - b.med) * dir;
      case 'attempts': return (a.f.attempts - b.f.attempts) * dir;
      default: return a.key.localeCompare(b.key) * dir;
    }
  });

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <strong>Quick Group Action:</strong>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        ${TEACHING_GROUPS.filter((g) => g.id !== 'squares').map((g) => `
          <button class="btn btn-secondary promote-group-btn" data-group="${g.id}" style="min-height:40px;font-size:15px;padding:6px 12px;">
            Mark ${g.label} known (Box 3)
          </button>
        `).join('')}
      </div>
    </div>
    <div class="card" style="overflow-x:auto;">
      <table class="data-table">
        <thead>
          <tr>
            <th><button data-sort="fact">Fact</button></th>
            <th><button data-sort="box">State (Box)</button></th>
            <th><button data-sort="acc">Accuracy</button></th>
            <th><button data-sort="med">Median Time</button></th>
            <th><button data-sort="attempts">Attempts</button></th>
            <th>Last Seen</th>
            <th>Next Due</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${r.f.a} × ${r.f.b}</td>
              <td>${r.stateLabel} (${r.f.box})</td>
              <td>${r.acc >= 0 ? r.acc + '%' : '—'}</td>
              <td>${r.med >= 0 ? (r.med / 1000).toFixed(1) + 's' : '—'}</td>
              <td>${r.f.attempts}</td>
              <td>${r.f.lastSeen ? toLocalDateString(r.f.lastSeen) : '—'}</td>
              <td>${r.f.due ? toLocalDateString(r.f.due) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('th button').forEach((b) => {
    b.addEventListener('click', () => {
      const col = b.dataset.sort;
      factsSort = { col, dir: factsSort.col === col && factsSort.dir === 'asc' ? 'desc' : 'asc' };
      renderParentFacts(container);
    });
  });

  container.querySelectorAll('.promote-group-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const gId = b.dataset.group;
      const now = Date.now();
      for (const k of getFactsIntroducedInGroup(gId)) {
        const cur = state.facts[k] || createEmptyFact(k);
        if (cur.box < 3) {
          state.facts[k] = { ...cur, box: 3, due: localMidnightTimestamp(now, 3), strategyViewed: true };
        }
      }
      if (!state.unlockedGroups.includes(gId)) state.unlockedGroups.push(gId);
      state.unlockedGroups = checkGroupUnlocks(state.facts, state.unlockedGroups, state.settings.unlockOverride);
      saveState();
      renderParentFacts(container);
    });
  });
}

function renderParentSessions(container) {
  const list = [...(state.sessions || [])].reverse();
  container.innerHTML = `
    <div class="card" style="overflow-x:auto;">
      ${list.length === 0 ? '<p class="muted">No completed sessions yet.</p>' : `
        <table class="data-table">
          <thead><tr><th>Date</th><th>Minutes</th><th>Questions</th><th>Accuracy</th><th>New Facts</th><th>Errors</th></tr></thead>
          <tbody>
            ${list.map((s) => {
              const mins = Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000));
              const acc = s.questions > 0 ? Math.round((s.correct / s.questions) * 100) : 0;
              return `
                <tr>
                  <td>${escapeHtml(s.date)}</td>
                  <td>${mins}</td>
                  <td>${s.questions}</td>
                  <td>${acc}%</td>
                  <td>${s.newFacts}</td>
                  <td>${s.errors}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

function renderParentSettings(container) {
  const s = state.settings;
  container.innerHTML = `
    <div class="card settings-grid">
      <div class="form-row">
        <label for="set-name">Child's name</label>
        <input id="set-name" class="text-input" type="text" value="${escapeHtml(state.profile.name)}" />
      </div>
      <div class="form-row">
        <label for="set-mins">Session length (5–15 min)</label>
        <input id="set-mins" class="text-input" type="number" min="5" max="15" value="${s.sessionMinutes}" />
      </div>
      <div class="form-row">
        <label for="set-thresh">Fast threshold (3000–8000 ms)</label>
        <input id="set-thresh" class="text-input" type="number" min="3000" max="8000" step="500" value="${s.fastThresholdMs}" />
      </div>
      <div class="form-row">
        <label for="set-new">New facts per session (0–5)</label>
        <input id="set-new" class="text-input" type="number" min="0" max="5" value="${s.newPerSession}" />
      </div>
      <div class="form-row">
        <label><input id="set-garden" type="checkbox" ${s.garden !== false ? 'checked' : ''} /> Garden theme on</label>
      </div>
      <div class="form-row">
        <label><input id="set-sound" type="checkbox" ${s.sound ? 'checked' : ''} /> Gentle sound chimes</label>
      </div>
      <div class="form-row">
        <label><input id="set-inverse" type="checkbox" ${s.inverseMode ? 'checked' : ''} /> Missing factor mode (3 × ? = 24)</label>
      </div>
      <div class="form-row">
        <label><input id="set-division" type="checkbox" ${s.divisionMode ? 'checked' : ''} /> Division mode (24 ÷ 3 = ?)</label>
      </div>
      <div class="form-row">
        <label><input id="set-softcap" type="checkbox" ${s.softCapEnabled !== false ? 'checked' : ''} /> 15-minute daily break reminder</label>
      </div>
      <div class="form-row">
        <label for="set-pin">Optional 4-digit parent PIN (leave blank for math question)</label>
        <input id="set-pin" class="text-input" type="text" maxlength="4" pattern="[0-9]{4}" value="${escapeHtml(s.pinCode || '')}" placeholder="e.g. 1234" />
      </div>
      <div class="form-row">
        <label><input id="set-unlock-all" type="checkbox" ${Array.isArray(s.unlockOverride) ? 'checked' : ''} /> Unlock all teaching groups</label>
      </div>

      <button id="save-settings-btn" class="btn btn-primary" style="justify-self:start;">Save settings</button>
      <div id="settings-saved-msg" class="muted"></div>

      <hr style="width:100%;border:0;border-top:1px solid var(--color-border);" />

      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button id="export-btn" class="btn btn-secondary" style="min-height:44px;font-size:16px;">Export progress (JSON)</button>
        <label class="btn btn-secondary" style="min-height:44px;font-size:16px;cursor:pointer;">
          Import progress (JSON)
          <input id="import-input" type="file" accept="application/json" style="display:none;" />
        </label>
        <button id="retake-placement-btn" class="btn btn-secondary" style="min-height:44px;font-size:16px;">Run placement check</button>
        <button id="reset-all-btn" class="btn btn-secondary" style="min-height:44px;font-size:16px;">Reset all progress</button>
      </div>
    </div>
  `;

  document.getElementById('save-settings-btn')?.addEventListener('click', () => {
    state.profile.name = document.getElementById('set-name').value.trim() || state.profile.name;
    state.settings.sessionMinutes = Math.max(5, Math.min(15, Number(document.getElementById('set-mins').value) || 8));
    state.settings.fastThresholdMs = Math.max(3000, Math.min(8000, Number(document.getElementById('set-thresh').value) || 4000));
    state.settings.newPerSession = Math.max(0, Math.min(5, Number(document.getElementById('set-new').value) ?? 3));
    state.settings.garden = document.getElementById('set-garden').checked;
    state.settings.sound = document.getElementById('set-sound').checked;
    state.settings.inverseMode = document.getElementById('set-inverse').checked;
    state.settings.divisionMode = document.getElementById('set-division').checked;
    state.settings.softCapEnabled = document.getElementById('set-softcap').checked;

    const pin = document.getElementById('set-pin').value.trim();
    if (/^\d{4}$/.test(pin)) {
      state.settings.pinCode = pin;
      state.settings.pinOrQuestion = 'pin';
    } else {
      state.settings.pinCode = '';
      state.settings.pinOrQuestion = 'question';
    }

    const unlockAll = document.getElementById('set-unlock-all').checked;
    state.settings.unlockOverride = unlockAll ? TEACHING_GROUPS.map((g) => g.id) : null;
    state.unlockedGroups = checkGroupUnlocks(state.facts, state.unlockedGroups, state.settings.unlockOverride);

    saveState();
    document.getElementById('settings-saved-msg').textContent = 'Settings saved!';
  });

  document.getElementById('export-btn')?.addEventListener('click', () => {
    const blob = new Blob([storage.exportJson(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fact-garden-backup-${toLocalDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      state = storage.importJson(txt);
      renderParent();
    }).catch(() => {
      alert('Could not import that file. Please check that it is a valid Fact Garden backup.');
    });
  });

  document.getElementById('retake-placement-btn')?.addEventListener('click', startPlacementCheck);

  document.getElementById('reset-all-btn')?.addEventListener('click', () => {
    if (confirm('Reset all progress and start fresh? This cannot be undone.')) {
      state = storage.resetAll();
      parentUnlocked = false;
      navigate('onboarding');
    }
  });
}

// ============================================================================
// 7. EXTRA MODES: FIX-IT, TABLE TOUR, SINGLE-FACT PRACTICE
// ============================================================================

function startFixItMode() {
  const trouble = getTroubleFacts(state.facts, 5);
  const keys = trouble.length > 0
    ? trouble.map((t) => t.key)
    : ALL_FACT_KEYS.filter((k) => state.facts[k]?.attempts > 0).slice(0, 5);

  if (keys.length === 0) {
    alert('Water the garden in a session first so we know which facts to practice!');
    return;
  }

  // Repeat each fact twice in cover-copy-compare
  const items = [];
  for (const k of keys) {
    items.push(k, k);
  }
  fixItState = { items, index: 0, phase: 'show', input: '', feedback: '' };
  navigate('fixit');
  scheduleFixItHide();
}

function scheduleFixItHide() {
  setTimeout(() => {
    if (currentScreen === 'fixit' && fixItState && fixItState.phase === 'show') {
      fixItState.phase = 'type';
      renderFixIt();
    }
  }, 3000);
}

function renderFixIt() {
  if (!fixItState || fixItState.index >= fixItState.items.length) {
    fixItState = null;
    navigate('home');
    return;
  }
  const key = fixItState.items[fixItState.index];
  const { a, b } = parseFactKey(key);
  const expected = a * b;

  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="fixit-exit" class="btn-quiet">← Home</button>
      <span class="muted">Fix-it Practice (${fixItState.index + 1} / ${fixItState.items.length})</span>
      <span></span>
    </div>
    <main class="play-stage">
      ${fixItState.phase === 'show' ? `
        <p class="muted">Look closely and remember:</p>
        <h1 class="question-text">${a} × ${b} = ${expected}</h1>
      ` : `
        <p class="muted">Type the answer from memory:</p>
        <h1 class="question-text">${a} × ${b} = ?</h1>
        <div class="answer-box">${escapeHtml(fixItState.input) || '&nbsp;'}</div>
        <div class="feedback-banner calm-blue">${escapeHtml(fixItState.feedback) || '&nbsp;'}</div>
        <div class="numpad" id="fixit-numpad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="num-key" data-digit="${d}">${d}</button>`).join('')}
          <button type="button" class="num-key" data-action="back">⌫</button>
          <button type="button" class="num-key" data-digit="0">0</button>
          <button type="button" class="num-key enter-key" data-action="enter">Enter</button>
        </div>
      `}
    </main>
  `;

  document.getElementById('fixit-exit')?.addEventListener('click', () => {
    fixItState = null;
    navigate('home');
  });

  document.getElementById('fixit-numpad')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit !== undefined && fixItState.input.length < 3) {
      fixItState.input += btn.dataset.digit;
      renderFixIt();
    } else if (btn.dataset.action === 'back') {
      fixItState.input = fixItState.input.slice(0, -1);
      renderFixIt();
    } else if (btn.dataset.action === 'enter' && fixItState.input !== '') {
      if (Number(fixItState.input) === expected) {
        fixItState.index += 1;
        fixItState.phase = 'show';
        fixItState.input = '';
        fixItState.feedback = '';
        renderFixIt();
        scheduleFixItHide();
      } else {
        fixItState.feedback = `${a} × ${b} = ${expected}. Let's look again!`;
        fixItState.phase = 'show';
        fixItState.input = '';
        renderFixIt();
        scheduleFixItHide();
      }
    }
  });
}

function startTourMode() {
  tourState = { factor: null, step: 0, input: '', feedback: '', startedAt: Date.now() };
  navigate('tour');
}

function renderTour() {
  if (!tourState) {
    navigate('home');
    return;
  }

  if (tourState.factor === null) {
    // Pick from unlocked factors
    const availableFactors = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    appEl.innerHTML = `
      <div class="play-topbar">
        <button id="tour-exit" class="btn-quiet">← Home</button>
        <h2 style="margin:0;">Table Tour</h2>
        <span></span>
      </div>
      <main class="home-main">
        <p class="muted">Pick a table to tour in order (counts toward practice minutes):</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:560px;">
          ${availableFactors.map((f) => `
            <button class="btn btn-secondary tour-pick-btn" data-factor="${f}" style="min-width:90px;">×${f}</button>
          `).join('')}
        </div>
      </main>
    `;
    document.getElementById('tour-exit')?.addEventListener('click', () => navigate('home'));
    document.querySelectorAll('.tour-pick-btn').forEach((b) => {
      b.addEventListener('click', () => {
        tourState.factor = Number(b.dataset.factor);
        tourState.step = 0;
        tourState.startedAt = Date.now();
        renderTour();
      });
    });
    return;
  }

  if (tourState.step > 12) {
    // Record extra-mode session for practice minutes only (does not change boxes)
    state.sessions.push({
      date: toLocalDateString(),
      startedAt: tourState.startedAt,
      endedAt: Date.now(),
      questions: 13,
      correct: 13,
      newFacts: 0,
      errors: 0,
      isExtraMode: true
    });
    saveState();
    tourState = null;
    navigate('home');
    return;
  }

  const f = tourState.factor;
  const n = tourState.step;
  const expected = f * n;

  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="tour-exit" class="btn-quiet">← Home</button>
      <span class="muted">×${f} Tour (${n + 1} / 13)</span>
      <span></span>
    </div>
    <main class="play-stage">
      <h1 class="question-text">${f} × ${n}</h1>
      <div class="answer-box">${escapeHtml(tourState.input) || '&nbsp;'}</div>
      <div class="feedback-banner calm-blue">${escapeHtml(tourState.feedback) || '&nbsp;'}</div>
      <div class="numpad" id="tour-numpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="num-key" data-digit="${d}">${d}</button>`).join('')}
        <button type="button" class="num-key" data-action="back">⌫</button>
        <button type="button" class="num-key" data-digit="0">0</button>
        <button type="button" class="num-key enter-key" data-action="enter">Enter</button>
      </div>
    </main>
  `;

  document.getElementById('tour-exit')?.addEventListener('click', () => {
    tourState = null;
    navigate('home');
  });

  document.getElementById('tour-numpad')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit !== undefined && tourState.input.length < 3) {
      tourState.input += btn.dataset.digit;
      renderTour();
    } else if (btn.dataset.action === 'back') {
      tourState.input = tourState.input.slice(0, -1);
      renderTour();
    } else if (btn.dataset.action === 'enter' && tourState.input !== '') {
      if (Number(tourState.input) === expected) {
        tourState.step += 1;
        tourState.input = '';
        tourState.feedback = '';
        renderTour();
      } else {
        tourState.feedback = `Try ${f} × ${n} = ${expected}`;
        tourState.input = '';
        renderTour();
      }
    }
  });
}

function renderSinglePractice() {
  if (!singlePracticeKey) {
    navigate('garden');
    return;
  }
  const { a, b } = parseFactKey(singlePracticeKey);
  const expected = a * b;

  appEl.innerHTML = `
    <div class="play-topbar">
      <button id="single-back" class="btn-quiet">← My Garden</button>
      <span></span><span></span>
    </div>
    <main class="play-stage">
      <h1 class="question-text">${a} × ${b}</h1>
      <div class="answer-box ${playFeedback?.type === 'correct' ? 'state-correct' : playFeedback?.type === 'wrong' ? 'state-wrong' : ''}">
        ${escapeHtml(playInput) || '&nbsp;'}
      </div>
      <div class="feedback-banner ${playFeedback?.type === 'wrong' ? 'calm-blue' : 'positive'}">
        ${playFeedback ? escapeHtml(playFeedback.text) : '&nbsp;'}
      </div>
      <div class="numpad" id="single-numpad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" class="num-key" data-digit="${d}">${d}</button>`).join('')}
        <button type="button" class="num-key" data-action="back">⌫</button>
        <button type="button" class="num-key" data-digit="0">0</button>
        <button type="button" class="num-key enter-key" data-action="enter">Enter</button>
      </div>
    </main>
  `;

  document.getElementById('single-back')?.addEventListener('click', () => navigate('garden'));
  document.getElementById('single-numpad')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.digit !== undefined && playInput.length < 3) {
      playInput += btn.dataset.digit;
      renderSinglePractice();
    } else if (btn.dataset.action === 'back') {
      playInput = playInput.slice(0, -1);
      renderSinglePractice();
    } else if (btn.dataset.action === 'enter' && playInput !== '') {
      if (Number(playInput) === expected) {
        playCorrectChime(state.settings.sound);
        playFeedback = { type: 'correct', text: 'Nice work!' };
        renderSinglePractice();
        setTimeout(() => {
          playFeedback = null;
          playInput = '';
          navigate('garden');
        }, 700);
      } else {
        playGentleHint(state.settings.sound);
        playFeedback = { type: 'wrong', text: `Not quite: ${a} × ${b} = ${expected}` };
        playInput = '';
        renderSinglePractice();
      }
    }
  });
}

// ============================================================================
// PHYSICAL KEYBOARD SUPPORT (NO CLICKING REQUIRED)
// ============================================================================

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (currentScreen === 'play' && state.currentSession) {
    if (playPaused) {
      playPaused = false;
      playStartTs = Date.now();
      resetIdleTimer();
      renderPlay();
      return;
    }

    if (state.currentSession.correctionPending) {
      if (/^[0-9]$/.test(e.key) && playCorrectionInput.length < 3) {
        playCorrectionInput += e.key;
        renderCorrectionView(state.currentSession.correctionPending);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        playCorrectionInput = playCorrectionInput.slice(0, -1);
        renderCorrectionView(state.currentSession.correctionPending);
      } else if (e.key === 'Enter' && playCorrectionInput !== '') {
        submitCorrectionAnswer();
      }
      return;
    }

    if (playFeedback) return;
    const item = state.currentSession.queue[state.currentSession.index];
    if (item?.kind === 'teach') {
      if (e.key === 'Enter' && playTeachReady) {
        document.getElementById('teach-gotit-btn')?.click();
      }
      return;
    }

    resetIdleTimer();
    if (/^[0-9]$/.test(e.key) && playInput.length < 3) {
      playInput += e.key;
      renderPlay();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      playHadBackspace = true;
      playInput = playInput.slice(0, -1);
      renderPlay();
    } else if (e.key === 'Enter' && playInput !== '') {
      submitPlayAnswer();
    }
  } else if (currentScreen === 'placement' && placementState && !placementState.done) {
    if (/^[0-9]$/.test(e.key) && placementState.input.length < 3) {
      placementState.input += e.key;
      renderPlacement();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      placementState.input = placementState.input.slice(0, -1);
      renderPlacement();
    } else if (e.key === 'Enter' && placementState.input !== '') {
      document.querySelector('#placement-numpad [data-action="enter"]')?.click();
    }
  } else if (currentScreen === 'fixit' && fixItState?.phase === 'type') {
    if (/^[0-9]$/.test(e.key) && fixItState.input.length < 3) {
      fixItState.input += e.key;
      renderFixIt();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      fixItState.input = fixItState.input.slice(0, -1);
      renderFixIt();
    } else if (e.key === 'Enter' && fixItState.input !== '') {
      document.querySelector('#fixit-numpad [data-action="enter"]')?.click();
    }
  } else if (currentScreen === 'tour' && tourState && tourState.factor !== null) {
    if (/^[0-9]$/.test(e.key) && tourState.input.length < 3) {
      tourState.input += e.key;
      renderTour();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      tourState.input = tourState.input.slice(0, -1);
      renderTour();
    } else if (e.key === 'Enter' && tourState.input !== '') {
      document.querySelector('#tour-numpad [data-action="enter"]')?.click();
    }
  } else if (currentScreen === 'single') {
    if (/^[0-9]$/.test(e.key) && playInput.length < 3) {
      playInput += e.key;
      renderSinglePractice();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      playInput = playInput.slice(0, -1);
      renderSinglePractice();
    } else if (e.key === 'Enter' && playInput !== '') {
      document.querySelector('#single-numpad [data-action="enter"]')?.click();
    }
  }
});

// Register Service Worker for offline PWA capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// Initial render
render();
