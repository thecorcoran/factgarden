/**
 * Evidence-based multiplication strategies and inline SVG visual renderers.
 * Covers all 169 ordered pairs (0..12 x 0..12) with zero external dependencies.
 */

import { getApplicableStrategyGroups } from './facts.js';

export const STRATEGY_META = {
  x0: {
    id: 'x0',
    label: '×0 Rule',
    visualType: 'empty-baskets',
    describe: () => 'Zero groups of anything is nothing. Anything times zero is 0.'
  },
  x1: {
    id: 'x1',
    label: '×1 Rule',
    visualType: 'array',
    describe: (a, b) => {
      const other = a === 1 ? b : a;
      return `One group of a number is just that number. 1 × ${other} = ${other}.`;
    }
  },
  x10: {
    id: 'x10',
    label: '×10 Pattern',
    visualType: 'array',
    describe: (a, b) => {
      const other = a === 10 ? b : a;
      return `Put a zero on the end: 10 × ${other} is ${other} tens, which is ${10 * other}.`;
    }
  },
  x2: {
    id: 'x2',
    label: 'Doubles (×2)',
    visualType: 'array',
    describe: (a, b) => {
      const other = a === 2 ? b : a;
      return `Doubles: add the number to itself. 2 × ${other} is ${other} + ${other} = ${2 * other}.`;
    }
  },
  x5: {
    id: 'x5',
    label: 'Count by 5s',
    visualType: 'skip-count',
    describe: (a, b) => {
      const other = a === 5 ? b : a;
      const steps = [];
      for (let i = 1; i <= Math.min(other, 12); i++) steps.push(i * 5);
      const list = steps.length > 0 ? steps.join(', ') : '0';
      return `Count by fives like a clock. 5 × ${other}: count ${list}. (Also half of 10 × ${other}.)`;
    }
  },
  x11: {
    id: 'x11',
    label: '×11 Pattern',
    visualType: 'array',
    describe: (a, b) => {
      const other = a === 11 ? b : a;
      if (other <= 9) {
        return `Up to 9: say the digit twice. 11 × ${other} = ${11 * other}.`;
      }
      return `For 10, 11, 12: 11 × ${other} is 10 × ${other} + ${other} = ${10 * other} + ${other} = ${11 * other}.`;
    }
  },
  x9: {
    id: 'x9',
    label: 'Ten Minus One (×9)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 9 ? b : a;
      return `Ten times it, then take one group away: 9 × ${other} = ${10 * other} − ${other} = ${9 * other}. The digits of the answer add up to 9.`;
    }
  },
  x3: {
    id: 'x3',
    label: 'Double + 1 Group (×3)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 3 ? b : a;
      return `Double it, then add one more group: 3 × ${other} = ${2 * other} + ${other} = ${3 * other}.`;
    }
  },
  x4: {
    id: 'x4',
    label: 'Double, Double (×4)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 4 ? b : a;
      return `Double, then double again: 4 × ${other} → ${2 * other}, then ${4 * other}.`;
    }
  },
  x6: {
    id: 'x6',
    label: '5s Plus 1 Group (×6)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 6 ? b : a;
      return `Use fives plus one more group: 6 × ${other} = 5 × ${other} + ${other} = ${5 * other} + ${other} = ${6 * other}.`;
    }
  },
  x7: {
    id: 'x7',
    label: 'Break Into 5 + 2 (×7)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 7 ? b : a;
      return `Break it into pieces you know: 7 × ${other} = 5 × ${other} + 2 × ${other} = ${5 * other} + ${2 * other} = ${7 * other}.`;
    }
  },
  x8: {
    id: 'x8',
    label: 'Double, Double, Double (×8)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 8 ? b : a;
      return `Double, double, double: 8 × ${other} → ${other}, ${2 * other}, ${4 * other}, ${8 * other}.`;
    }
  },
  x12: {
    id: 'x12',
    label: '10s Plus 2s (×12)',
    visualType: 'split-array',
    describe: (a, b) => {
      const other = a === 12 ? b : a;
      return `Ten groups plus two groups: 12 × ${other} = ${10 * other} + ${2 * other} = ${12 * other}.`;
    }
  },
  squares: {
    id: 'squares',
    label: 'Square Number',
    visualType: 'array',
    describe: (a) => `A square number makes a square: ${a} × ${a} = ${a * a}.`
  }
};

/**
 * Return all applicable strategies for (a, b), ordered newest-group-first
 * as required by the prompt ("show the strategy for the newest group that includes it").
 */
export function getStrategiesForFact(a, b) {
  const groups = getApplicableStrategyGroups(a, b);
  const newestFirst = [...groups].reverse();
  return newestFirst.map((id) => {
    const meta = STRATEGY_META[id];
    return {
      id: meta.id,
      label: meta.label,
      visualType: meta.visualType,
      text: meta.describe(a, b)
    };
  });
}

/**
 * Get the primary (newest group) strategy for (a, b).
 */
export function getPrimaryStrategy(a, b) {
  const list = getStrategiesForFact(a, b);
  return list[0] || {
    id: 'array',
    label: 'Array',
    visualType: 'array',
    text: `${a} groups of ${b} is ${a * b}.`
  };
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Determine split configuration for split-array visuals.
 * Returns { rows, cols, splitAfterRow, part1Label, part2Label } or null.
 */
function getSplitConfig(a, b) {
  // Orient split along the target factor (prefer splitting rows)
  const splitFactors = [12, 8, 7, 6, 4, 3, 9];
  let rows = a;
  let cols = b;
  let target = null;

  for (const f of splitFactors) {
    if (a === f) {
      target = f;
      rows = a;
      cols = b;
      break;
    }
    if (b === f) {
      target = f;
      rows = b;
      cols = a;
      break;
    }
  }

  if (!target || cols === 0) return null;

  if (target === 12) {
    return { rows, cols, splitAfterRow: 10, part1Label: `${10 * cols}`, part2Label: `${2 * cols}` };
  }
  if (target === 7) {
    return { rows, cols, splitAfterRow: 5, part1Label: `${5 * cols}`, part2Label: `${2 * cols}` };
  }
  if (target === 6) {
    return { rows, cols, splitAfterRow: 5, part1Label: `${5 * cols}`, part2Label: `${cols}` };
  }
  if (target === 8) {
    return { rows, cols, splitAfterRow: 4, part1Label: `${4 * cols}`, part2Label: `${4 * cols}` };
  }
  if (target === 4) {
    return { rows, cols, splitAfterRow: 2, part1Label: `${2 * cols}`, part2Label: `${2 * cols}` };
  }
  if (target === 3) {
    return { rows, cols, splitAfterRow: 2, part1Label: `${2 * cols}`, part2Label: `${cols}` };
  }
  if (target === 9) {
    // 10 rows with last row crossed/faded
    return { rows: 10, cols, splitAfterRow: 9, isMinusOne: true, part1Label: `${9 * cols}`, part2Label: `−${cols}` };
  }
  return null;
}

/**
 * Render an inline SVG visual for a fact `{ a, b }` (or `"7x8"`).
 * @param {{a:number, b:number}|string} fact
 * @param {'auto'|'array'|'split-array'|'skip-count'|'empty-baskets'|'square'} [type='auto']
 * @param {{animate?: boolean}} [options]
 * @returns {string} Valid inline SVG markup
 */
export function renderVisual(fact, type = 'auto', options = {}) {
  const { a, b } = typeof fact === 'string'
    ? (() => { const [x, y] = fact.split('x').map(Number); return { a: x, b: y }; })()
    : fact;

  const safeA = Math.max(0, Math.min(12, Number(a) || 0));
  const safeB = Math.max(0, Math.min(12, Number(b) || 0));

  let resolvedType = type;
  if (resolvedType === 'auto') {
    if (safeA === 0 || safeB === 0) {
      resolvedType = 'empty-baskets';
    } else {
      resolvedType = getPrimaryStrategy(safeA, safeB).visualType;
    }
  }

  if (safeA === 0 || safeB === 0 || resolvedType === 'empty-baskets') {
    return renderEmptyBasketsSvg(safeA, safeB);
  }
  if (resolvedType === 'skip-count') {
    return renderSkipCountSvg(safeA, safeB);
  }
  if (resolvedType === 'split-array') {
    const split = getSplitConfig(safeA, safeB);
    if (split) {
      return renderSplitArraySvg(split, options.animate);
    }
  }
  return renderArraySvg(safeA, safeB);
}

function renderEmptyBasketsSvg(a, b) {
  const baskets = Math.min(Math.max(a, b, 1), 6);
  const width = 320;
  const height = 160;
  const spacing = width / (baskets + 1);
  let shapes = '';
  for (let i = 1; i <= baskets; i++) {
    const cx = Math.round(spacing * i);
    shapes += `
      <g transform="translate(${cx}, 85)">
        <ellipse cx="0" cy="0" rx="18" ry="12" fill="none" stroke="var(--color-muted, #6B6B6B)" stroke-width="2.5" stroke-dasharray="4 3" />
        <text x="0" y="5" text-anchor="middle" font-size="14" fill="var(--color-muted, #6B6B6B)">0</text>
      </g>`;
  }
  return `<svg class="fact-visual-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${a} times ${b} equals 0: empty groups`)}" xmlns="http://www.w3.org/2000/svg">
    ${shapes}
    <text x="${width / 2}" y="138" text-anchor="middle" font-size="16" font-weight="600" fill="var(--color-text, #2B2B2B)">${a} × ${b} = 0 (nothing inside)</text>
  </svg>`;
}

function renderArraySvg(rows, cols) {
  const width = 320;
  const height = 240;
  const padLeft = 42;
  const padTop = 34;
  const availW = width - padLeft - 24;
  const availH = height - padTop - 20;
  const step = Math.min(availW / Math.max(cols, 1), availH / Math.max(rows, 1), 26);
  const r = Math.max(3.5, Math.min(9, step * 0.34));

  const gridW = cols * step;
  const gridH = rows * step;
  const startX = padLeft + (availW - gridW) / 2 + step / 2;
  const startY = padTop + (availH - gridH) / 2 + step / 2;

  let dots = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = (startX + col * step).toFixed(1);
      const cy = (startY + row * step).toFixed(1);
      // Color-split rule: alternate shade every 5 rows/cols to support "fives plus more"
      const blockShade = ((Math.floor(row / 5) + Math.floor(col / 5)) % 2 === 0);
      const fill = blockShade ? 'var(--color-primary, #2F7D5B)' : 'var(--color-stage-sprout, #8CC084)';
      dots += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${fill}" />`;
    }
  }

  const labelTopX = (startX + (cols - 1) * step / 2).toFixed(1);
  const labelLeftY = (startY + (rows - 1) * step / 2 + 5).toFixed(1);

  return `<svg class="fact-visual-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${rows} by ${cols} array of dots`)}" xmlns="http://www.w3.org/2000/svg">
    <text x="${labelTopX}" y="20" text-anchor="middle" font-size="16" font-weight="700" fill="var(--color-text, #2B2B2B)">${cols}</text>
    <text x="18" y="${labelLeftY}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--color-text, #2B2B2B)">${rows}</text>
    ${dots}
  </svg>`;
}

function renderSplitArraySvg(split, animate = false) {
  const { rows, cols, splitAfterRow, isMinusOne, part1Label, part2Label } = split;
  const width = 340;
  const height = 250;
  const padLeft = 38;
  const padTop = 32;
  const gap = 12;
  const availW = width - padLeft - 82;
  const availH = height - padTop - 20 - gap;
  const step = Math.min(availW / Math.max(cols, 1), availH / Math.max(rows, 1), 22);
  const r = Math.max(3, Math.min(8, step * 0.34));

  const gridW = cols * step;
  const startX = padLeft + (availW - gridW) / 2 + step / 2;
  const startY = padTop + step / 2;

  let dots = '';
  for (let row = 0; row < rows; row++) {
    const extraY = row >= splitAfterRow ? gap : 0;
    const isSecondPart = row >= splitAfterRow;
    for (let col = 0; col < cols; col++) {
      const cx = (startX + col * step).toFixed(1);
      const cy = (startY + row * step + extraY).toFixed(1);
      if (isMinusOne && isSecondPart) {
        dots += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="var(--color-muted, #6B6B6B)" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.6" />`;
      } else {
        const fill = isSecondPart ? 'var(--color-accent, #E0A526)' : 'var(--color-primary, #2F7D5B)';
        dots += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${fill}" />`;
      }
    }
  }

  const lineY = (startY + splitAfterRow * step - step / 2 + gap / 2).toFixed(1);
  const lineX1 = (startX - step / 2 - 4).toFixed(1);
  const lineX2 = (startX + (cols - 1) * step + step / 2 + 4).toFixed(1);

  const labelX = (Number(lineX2) + 12).toFixed(1);
  const part1Y = (startY + ((splitAfterRow - 1) * step) / 2 + 5).toFixed(1);
  const part2Rows = rows - splitAfterRow;
  const part2Y = (startY + splitAfterRow * step + gap + ((part2Rows - 1) * step) / 2 + 5).toFixed(1);

  const animClass = animate ? ' split-animate' : '';

  return `<svg class="fact-visual-svg${animClass}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`Split array showing ${part1Label} and ${part2Label}`)}" xmlns="http://www.w3.org/2000/svg">
    <text x="${(startX + (cols - 1) * step / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="15" font-weight="700" fill="var(--color-text, #2B2B2B)">${cols}</text>
    <text x="16" y="${part1Y}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--color-primary, #2F7D5B)">${splitAfterRow}</text>
    <text x="16" y="${part2Y}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--color-muted, #6B6B6B)">${isMinusOne ? '−1' : part2Rows}</text>
    ${dots}
    <line class="split-line" x1="${lineX1}" y1="${lineY}" x2="${lineX2}" y2="${lineY}" stroke="var(--color-text, #2B2B2B)" stroke-width="2" stroke-dasharray="5 4" />
    <text x="${labelX}" y="${part1Y}" font-size="15" font-weight="700" fill="var(--color-primary, #2F7D5B)">${escapeXml(part1Label)}</text>
    <text x="${labelX}" y="${part2Y}" font-size="15" font-weight="700" fill="var(--color-accent, #E0A526)">${escapeXml(part2Label)}</text>
  </svg>`;
}

function renderSkipCountSvg(a, b) {
  // Prefer jumping by 5 if one factor is 5, otherwise jump by max(a, b)
  const stepSize = a === 5 || b === 5 ? 5 : Math.min(a, b);
  const jumps = stepSize === a ? b : a;
  const width = 340;
  const height = 160;
  const startX = 24;
  const endX = width - 24;
  const baseY = 112;
  const jumpCount = Math.max(1, jumps);
  const dx = (endX - startX) / jumpCount;

  let arcs = '';
  let ticks = '';
  for (let i = 0; i <= jumpCount; i++) {
    const x = (startX + i * dx).toFixed(1);
    const val = i * stepSize;
    ticks += `<line x1="${x}" y1="${baseY - 5}" x2="${x}" y2="${baseY + 5}" stroke="var(--color-text, #2B2B2B)" stroke-width="2" />`;
    ticks += `<text x="${x}" y="${baseY + 24}" text-anchor="middle" font-size="${jumpCount > 9 ? 11 : 13}" font-weight="${i === jumpCount ? 700 : 500}" fill="var(--color-text, #2B2B2B)">${val}</text>`;

    if (i < jumpCount) {
      const xNext = (startX + (i + 1) * dx).toFixed(1);
      const midX = (startX + (i + 0.5) * dx).toFixed(1);
      const arcTop = baseY - Math.min(48, Math.max(22, dx * 0.75));
      arcs += `<path d="M ${x} ${baseY - 6} Q ${midX} ${arcTop} ${xNext} ${baseY - 6}" fill="none" stroke="var(--color-primary, #2F7D5B)" stroke-width="2.2" />`;
      if (jumpCount <= 8 || i === 0) {
        arcs += `<text x="${midX}" y="${arcTop + 8}" text-anchor="middle" font-size="11" fill="var(--color-primary, #2F7D5B)">+${stepSize}</text>`;
      }
    }
  }

  return `<svg class="fact-visual-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`Number line counting by ${stepSize}s, ${jumps} jumps to ${a * b}`)}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${startX}" y1="${baseY}" x2="${endX}" y2="${baseY}" stroke="var(--color-text, #2B2B2B)" stroke-width="2.5" />
    ${arcs}
    ${ticks}
  </svg>`;
}
