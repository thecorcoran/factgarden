# Fact Garden

An offline-capable, installable Progressive Web App (PWA) for learning multiplication facts `0 × 0` through `12 × 12` using spaced retrieval, teach-then-practice, incremental rehearsal, and calm effort-focused feedback.

## Features

- **Zero dependencies, zero tracking:** Plain HTML, CSS, and vanilla ES modules. All progress stays on the device in `localStorage`.
- **91 Fact Families:** Commutative pairs (`7 × 8` and `8 × 7`) share mastery tracking while displaying both orders.
- **Fact Garden Visuals:** Each fact is a plant growing from Empty Soil → Seed → Sprout → Seedling → Growing → Budding → Bloom.
- **Evidence-Based Scheduling:** Modified Leitner boxes (0–5) with median-of-3 latency, 3-day mastery rule, overdue grace, incremental rehearsal for new facts, and interleaving.
- **Parent Dashboard:** Protected by a math question or optional 4-digit PIN, with Overview, sortable Facts table, Sessions log, Settings, JSON Export/Import, and Reset.

## Running Unit Tests

Requires Node.js 18+:

```bash
node --test tests/engine.test.js
```

## Publishing on GitHub Pages

1. Create a new repository on GitHub and push the contents of this folder to the `main` branch.
2. Open the repository on GitHub → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, select `main` and `/ (root)`, and click **Save**.
4. Wait ~1 minute for GitHub Pages to publish your URL (e.g., `https://<username>.github.io/<repo>/`).

## Installing as a Desktop App (Chrome or Edge)

1. Open your published Fact Garden URL (or `http://localhost:<port>` if serving locally) in **Google Chrome** or **Microsoft Edge**.
2. Click the **Install** icon in the right side of the address bar (or open the browser menu `⋮` → **Cast, save, and share** → **Install Fact Garden...** / **Apps** → **Install this site as an app**).
3. Check **Create desktop shortcut** if prompted.
4. Fact Garden now opens in its own standalone window from the desktop icon and works offline.

## Parent Manual Test Checklist

Run through these checks together before handing the app over:

- [ ] **First run & Placement:** Open the app fresh, enter her name, and complete (or skip) the ~20-question placement check. Verify the Home screen greets her by name.
- [ ] **Teach card & 2-second look:** Start a session ("Water the garden"). When a new fact's Teach card appears, confirm "Got it" waits 2 seconds before enabling, and "Show me another way" cycles strategies if multiple apply.
- [ ] **Wrong answer & Correction:** Intentionally type a wrong answer. Confirm the box turns calm blue (no red X), shows the answer + visual + strategy, requires typing the right answer, and re-asks the fact later in the session.
- [ ] **Close mid-session:** Close the browser/app window halfway through a session. Reopen it and confirm the Home button says **"Keep going"** and resumes at the exact question where she left off.
- [ ] **Airplane-mode / Offline test:** After loading the app once, disconnect Wi-Fi / enable Airplane mode. Reopen the installed desktop app and confirm it loads, plays a session, and saves progress with zero network errors.
- [ ] **My Garden:** Open **My garden**, tap a cell, and verify the plant stage, history, strategy, and "Practice this one" button work.
- [ ] **Parent Export/Import:** Open **⚙ Parent**, answer the math check, export a JSON backup, and test importing it back.
