// Map only observed timing boundaries; never interpolate missing sung words.
const key = text => typeof text === 'string' ? text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
const validInterval = (word, duration) => Number.isFinite(word?.start) && Number.isFinite(word?.end) && word.start >= 0 && word.end > word.start && word.end <= duration + .1;
const interval = (rows, duration) => {
  if (!rows.length || rows.some(row => !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end < row.start || row.end > duration + .1)) return null;
  if (rows.some((row, index) => index > 0 && row.start < rows[index - 1].end - .01)) return null;
  const value = { start: rows[0].start, end: Math.min(rows.at(-1).end, duration) };
  return validInterval(value, duration) ? value : null;
};

function characterTiming(units, characters, duration) {
  if (!Array.isArray(characters) || !characters.length) return null;
  const letters = characters.flatMap(row => {
    const normalized = key(row.text);
    return normalized ? [{ ...row, key: normalized }] : [];
  });
  if (letters.some(row => Array.from(row.key).length !== 1) || letters.map(row => row.key).join('') !== units.map(unit => key(unit.text)).join('')) return null;
  let cursor = 0;
  return units.map(unit => {
    const length = Array.from(key(unit.text)).length;
    const timing = interval(letters.slice(cursor, cursor + length), duration);
    cursor += length;
    return { ...unit, ...(timing || {}) };
  });
}

function exactWordTiming(units, observed, duration) {
  if (units.map(unit => key(unit.text)).join('') !== observed.map(word => word.key).join('')) return null;
  const starts = new Map(), ends = new Map(); let offset = 0;
  observed.forEach((word, index) => { starts.set(offset, index); offset += word.key.length; ends.set(offset, index); });
  offset = 0;
  return units.map(unit => {
    const first = starts.get(offset); offset += key(unit.text).length;
    const last = ends.get(offset);
    const timing = first !== undefined && last !== undefined && first <= last ? interval(observed.slice(first, last + 1), duration) : null;
    // A returned phrase can cover several supplied words. Without characters,
    // its endpoints cannot establish individual boundaries inside that phrase.
    return { ...unit, ...(timing || {}) };
  });
}

function partialWordTiming(units, observed, duration) {
  const expected = units.map((unit, index) => ({ key: key(unit.text), index })).filter(unit => unit.key);
  const rows = expected.length + 1, width = observed.length + 1;
  if (expected.length * observed.length > 9_000_000) return units;
  const costs = new Uint16Array(rows * width), moves = new Uint8Array(rows * width);
  for (let i = 1; i < rows; i++) { costs[i * width] = i; moves[i * width] = 2; }
  for (let j = 1; j < width; j++) { costs[j] = j; moves[j] = 3; }
  for (let i = 1; i < rows; i++) for (let j = 1; j < width; j++) {
    const index = i * width + j;
    let cost = costs[(i - 1) * width + j - 1] + (expected[i - 1].key === observed[j - 1].key ? 0 : 1), move = 1;
    const choose = (candidate, direction) => { if (candidate < cost) { cost = candidate; move = direction; } };
    choose(costs[(i - 1) * width + j] + 1, 2);
    choose(costs[i * width + j - 1] + 1, 3);
    // Splits such as Can't -> Can / t still use real span endpoints.
    for (let count = 2; count <= 4; count++) {
      if (j >= count && observed.slice(j - count, j).map(word => word.key).join('') === expected[i - 1].key) choose(costs[(i - 1) * width + j - count], 4 + count);
      if (i >= count && expected.slice(i - count, i).map(unit => unit.key).join('') === observed[j - 1].key) choose(costs[(i - count) * width + j - 1], 8 + count);
    }
    costs[index] = cost; moves[index] = move;
  }
  const mapped = units.map(unit => ({ ...unit }));
  const expectedCounts = new Map(), observedCounts = new Map();
  for (const unit of expected) expectedCounts.set(unit.key, (expectedCounts.get(unit.key) || 0) + 1);
  for (const word of observed) observedCounts.set(word.key, (observedCounts.get(word.key) || 0) + 1);
  let i = expected.length, j = observed.length;
  const assign = (reference, first, last) => {
    const referenceKey = key(mapped[reference].text);
    // A missing/extra repeated word has multiple plausible occurrences. Keep
    // it for review rather than moving a later chorus onto an earlier line.
    const expectedCount = expectedCounts.get(referenceKey) || 0, observedCount = observedCounts.get(referenceKey) || 0;
    if ((expectedCount > 1 || observedCount > 1) && expectedCount !== observedCount) return;
    const timing = interval(observed.slice(first, last), duration);
    if (timing) mapped[reference] = { ...mapped[reference], ...timing };
  };
  while (i || j) {
    const move = moves[i * width + j];
    if (move === 1) {
      if (expected[i - 1].key === observed[j - 1].key) assign(expected[i - 1].index, j - 1, j);
      i--; j--;
    } else if (move === 2) i--;
    else if (move === 3) j--;
    else if (move >= 6 && move <= 8) { const count = move - 4; assign(expected[i - 1].index, j - count, j); i--; j -= count; }
    else if (move >= 10 && move <= 12) { i -= move - 8; j--; }
    else break;
  }
  return mapped;
}

export function mapAlignmentUnits(units, alignment, duration) {
  const observed = (Array.isArray(alignment?.words) ? alignment.words : []).map(word => ({ ...word, key: key(word.text) })).filter(word => word.key);
  const clean = units.map(unit => ({ text: unit.text, start: null, end: null }));
  const words = characterTiming(clean, alignment?.characters, duration) || exactWordTiming(clean, observed, duration) || partialWordTiming(clean, observed, duration);
  // A bad interval stays local instead of invalidating every later lyric line.
  let previousEnd = 0;
  return words.map(word => {
    if (!validInterval(word, duration) || word.start < previousEnd - .01) return { text: word.text, start: null, end: null };
    previousEnd = word.end;
    return word;
  });
}
