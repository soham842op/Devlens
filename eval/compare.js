// Paired before/after comparison of two bench.js result files (same corpus, same files and commits).
// Usage: node eval/compare.js <before.json> <after.json> [out.json]
// - 95% CIs: percentile bootstrap over items (files or commits), 10,000 resamples, seed 42
// - Significance: exact McNemar test on per-item correctness (two-sided binomial on the discordant pairs)
const fs = require('fs');
const path = require('path');

const [beforeFile, afterFile, outFile = path.join(__dirname, 'results', 'comparison.json')] = process.argv.slice(2);
if (!afterFile) { console.error('usage: node eval/compare.js <before.json> <after.json> [out.json]'); process.exit(1); }
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
const B = 10000;

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const quantile = (xs, q) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

function logBinomPmf(k, n) { // log C(n,k) + n*log(0.5)
  let lc = 0;
  for (let i = 1; i <= k; i++) lc += Math.log(n - k + i) - Math.log(i);
  return lc + n * Math.log(0.5);
}
function mcnemarExact(b, c) { // b: only before correct, c: only after correct
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  const logs = [];
  for (let i = 0; i <= k; i++) logs.push(logBinomPmf(i, n));
  const m = Math.max(...logs);
  const tail = Math.exp(m) * logs.reduce((s, l) => s + Math.exp(l - m), 0);
  return Math.min(1, 2 * tail);
}

// metric(items, predKey, truthKey) on paired items; returns point estimates, CIs and the delta's CI
function paired(itemsBefore, itemsAfter, predKey, truthKey, metric) {
  const afterById = new Map(itemsAfter.map(i => [i.id, i]));
  const pairs = itemsBefore.filter(i => afterById.has(i.id)).map(i => ({ b: i, a: afterById.get(i.id) }));
  const scoreOf = (ps, side) => metric(ps.map(p => ({ pred: p[side][predKey], truth: p[side][truthKey] })));
  const point = { before: scoreOf(pairs, 'b'), after: scoreOf(pairs, 'a') };
  const rand = rng(42);
  const draws = { before: [], after: [], delta: [] };
  for (let r = 0; r < B; r++) {
    const sample = Array.from(pairs, () => pairs[Math.floor(rand() * pairs.length)]);
    const sb = scoreOf(sample, 'b'), sa = scoreOf(sample, 'a');
    draws.before.push(sb); draws.after.push(sa); draws.delta.push(sa - sb);
  }
  const ci = xs => [quantile(xs, 0.025), quantile(xs, 0.975)];
  let onlyBefore = 0, onlyAfter = 0;
  for (const p of pairs) {
    const cb = p.b[predKey] === p.b[truthKey], ca = p.a[predKey] === p.a[truthKey];
    if (cb && !ca) onlyBefore++; else if (ca && !cb) onlyAfter++;
  }
  return { n: pairs.length, before: point.before, before_ci95: ci(draws.before), after: point.after, after_ci95: ci(draws.after),
           delta: point.after - point.before, delta_ci95: ci(draws.delta),
           mcnemar: { only_before_correct: onlyBefore, only_after_correct: onlyAfter, p_value: mcnemarExact(onlyBefore, onlyAfter) } };
}

const counts = rows => { let tp = 0, fp = 0, fn = 0; for (const r of rows) { if (r.pred && r.truth) tp++; else if (r.pred) fp++; else if (r.truth) fn++; } return { tp, fp, fn }; };
const METRICS = {
  precision: rows => { const { tp, fp } = counts(rows); return tp + fp ? tp / (tp + fp) : NaN; },
  recall: rows => { const { tp, fn } = counts(rows); return tp + fn ? tp / (tp + fn) : NaN; },
  f1: rows => { const { tp, fp, fn } = counts(rows); return tp ? (2 * tp) / (2 * tp + fp + fn) : 0; },
  accuracy: rows => rows.filter(r => r.pred === r.truth).length / rows.length,
};

const out = { before: { file: beforeFile, devlens_commit: before.devlens_commit }, after: { file: afterFile, devlens_commit: after.devlens_commit },
              method: { ci: `percentile bootstrap, ${B} resamples, seed 42`, test: 'exact McNemar (two-sided)' }, sets: {} };
const pct = x => (x * 100).toFixed(1);
for (const set of Object.keys(after.sets).filter(s => before.sets[s]?.items)) {
  const fb = before.sets[set].items.files, fa = after.sets[set].items.files;
  const errB = fb.filter(i => i.err_truth !== null), errA = fa.filter(i => i.err_truth !== null);
  const cb = before.sets[set].items.commits, ca = after.sets[set].items.commits;
  const res = { tests: {}, error_handling: {}, commits_description_only: {} };
  for (const m of ['precision', 'recall', 'f1']) {
    res.tests[m] = paired(fb, fa, 'test_pred', 'test_truth', METRICS[m]);
    res.error_handling[m] = paired(errB, errA, 'err_pred', 'err_truth', METRICS[m]);
  }
  res.commits_description_only.accuracy = paired(cb, ca, 'pred_description_only', 'label', METRICS.accuracy);
  res.commits_description_only.majority_baseline = after.sets[set].commits.majority_baseline;
  res.commits_parsed = {
    before: before.sets[set].performance.commits_parsed, after: after.sets[set].performance.commits_parsed,
    in_history: after.sets[set].performance.repos.reduce((s, r) => s + r.commits_in_history, 0),
  };
  out.sets[set] = res;

  console.log(`\n[${set}]  commits parsed ${res.commits_parsed.before} -> ${res.commits_parsed.after} of ${res.commits_parsed.in_history}`);
  const line = (name, r) => console.log(`  ${name.padEnd(28)} ${pct(r.before)}% [${pct(r.before_ci95[0])}, ${pct(r.before_ci95[1])}] -> ${pct(r.after)}% [${pct(r.after_ci95[0])}, ${pct(r.after_ci95[1])}]  delta ${pct(r.delta)} pts [${pct(r.delta_ci95[0])}, ${pct(r.delta_ci95[1])}]  McNemar p=${r.mcnemar.p_value.toExponential(2)} (n=${r.n})`);
  for (const m of ['precision', 'recall', 'f1']) line(`tests ${m}`, res.tests[m]);
  for (const m of ['precision', 'recall', 'f1']) line(`error handling ${m}`, res.error_handling[m]);
  line('commit type (no prefix) acc', res.commits_description_only.accuracy);
  console.log(`  majority baseline: ${res.commits_description_only.majority_baseline.label} ${pct(res.commits_description_only.majority_baseline.accuracy)}%`);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`\nwrote ${outFile}`);
