// DevLens benchmark: runs DevLens's own scanner, git parser and LLM step and scores them against ground truth.
// Usage: node eval/bench.js --corpus=<dir> [--devlens=<src root>] [--out=<file>] [--personal=<dir>] [--llm-runs=N]
//   --corpus    folder from setup_corpus.js (contains dev/ and heldout/)
//   --devlens   DevLens checkout to evaluate (default: this repo); point it at an older checkout for before/after
//   --sets      comma-separated corpus subsets to run (default: dev,heldout)
//   --personal  optional extra folder of your own repos (scanned, timed and used for the LLM runs)
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { spawnSync } = require('child_process');

const arg = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || `=${dflt ?? ''}`).split('=').slice(1).join('=') || dflt;
const HERE = __dirname;
const DEVLENS = path.resolve(arg('devlens', path.join(HERE, '..')));
const CORPUS = arg('corpus') && path.resolve(arg('corpus'));
const PERSONAL = arg('personal') && path.resolve(arg('personal'));
const OUT_FILE = path.resolve(arg('out', path.join(HERE, 'results', 'results.json')));
const WORK = path.join(HERE, 'out');
const LLM_RUNS = Number(arg('llm-runs', '0'));
const SETS = arg('sets', 'dev,heldout').split(',');
const SCAN_REPEATS = 3;
if (!CORPUS) { console.error('usage: node eval/bench.js --corpus=<dir> [...]'); process.exit(1); }

const R = Module.createRequire(path.join(DEVLENS, 'package.json'));
R('ts-node').register({ transpileOnly: true, project: path.join(DEVLENS, 'tsconfig.json') });
const { initDB } = R('./src/db.ts');
const { findRepos, scanRepo } = R('./src/scanner.ts');
const gitModule = R('./src/git.ts');
const { parseGitHistory } = gitModule;
const Database = R('better-sqlite3');
const ts = R('typescript');

// Older versions did not export classifyCommit(); compile git.ts's own source with one extra export line.
function loadClassifyCommit() {
  if (gitModule.classifyCommit) return gitModule.classifyCommit;
  const file = path.join(DEVLENS, 'src', 'git.ts');
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText + '\nmodule.exports.__classifyCommit = classifyCommit;\n';
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(js, file);
  return m.exports.__classifyCommit;
}
const classifyCommit = loadClassifyCommit();

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const ms = t0 => Number(process.hrtime.bigint() - t0) / 1e6;
const ratio = (a, b) => (b ? a / b : null);
const rmDb = p => { for (const ext of ['', '-shm', '-wal']) fs.rmSync(p + ext, { force: true }); };
const gitOut = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 }).stdout.trim();
function prf(rows, pred, truth) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) { const p = pred(r), t = truth(r); if (p && t) tp++; else if (p) fp++; else if (t) fn++; else tn++; }
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  const f1 = precision !== null && recall !== null && precision + recall ? (2 * precision * recall) / (precision + recall) : null;
  return { n: rows.length, tp, fp, fn, tn, precision, recall, f1, accuracy: ratio(tp + tn, rows.length),
           predicted_rate: ratio(tp + fp, rows.length), true_rate: ratio(tp + fn, rows.length) };
}

// ── Scan + git parsing, timed (DevLens's own functions, default settings) ─────────
function scanCorpus(root, dbPath) {
  rmDb(dbPath);
  const db = initDB(dbPath);
  const perRepo = [];
  for (const repoPath of findRepos(root)) {
    const repo = path.basename(repoPath);
    let t = process.hrtime.bigint();
    const files = scanRepo(repoPath, repo, db);
    const scanMs = ms(t);
    t = process.hrtime.bigint();
    const commits = parseGitHistory(repoPath, repo, db);
    perRepo.push({ repo, root: repoPath, files, commits, scanMs, gitMs: ms(t) });
  }
  const loc = db.prepare('SELECT COALESCE(SUM(lines_of_code),0) n FROM code_files').get().n;
  db.close();
  const sum = k => perRepo.reduce((s, r) => s + r[k], 0);
  return { perRepo, loc, files: sum('files'), commits: sum('commits'), scanMs: sum('scanMs'), gitMs: sum('gitMs') };
}

function timedScans(name, root) {
  const dbPath = path.join(WORK, `${name}.db`);
  const reps = [];
  for (let i = 0; i < SCAN_REPEATS; i++) reps.push(scanCorpus(root, dbPath));
  const last = reps[reps.length - 1];
  const scanMed = median(reps.map(r => r.scanMs)), gitMed = median(reps.map(r => r.gitMs));
  const repos = last.perRepo.map(r => ({ repo: r.repo, files: r.files, commits_parsed: r.commits,
    commits_in_history: Number(gitOut(['rev-list', '--count', 'HEAD'], r.root)), head: gitOut(['rev-parse', 'HEAD'], r.root) }));
  console.log(`[${name}] ${repos.length} repos, ${last.files} files, ${last.loc} LOC, ${last.commits} commits parsed | scan ${scanMed.toFixed(0)} ms, git ${gitMed.toFixed(0)} ms (median of ${SCAN_REPEATS})`);
  return { dbPath, roots: Object.fromEntries(last.perRepo.map(r => [r.repo, r.root])),
    summary: { repos, files: last.files, loc: last.loc, commits_parsed: last.commits,
      scan_ms_median: scanMed, git_ms_median: gitMed, scan_ms_all: reps.map(r => r.scanMs),
      files_per_s: last.files / (scanMed / 1000), loc_per_s: last.loc / (scanMed / 1000) } };
}

// ── Ground truth: test files by path convention (relative to the repo root) ───────
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'testing']);
function isTestFileByConvention(relPath) {
  const parts = relPath.toLowerCase().split(/[\\/]/);
  const base = parts[parts.length - 1];
  return parts.slice(0, -1).some(p => TEST_DIRS.has(p)) ||
    /^test_.*\.py$|_test\.py$|^tests?\.py$|^conftest\.py$|_test\.go$|\.(test|spec)\.[cm]?[jt]sx?$|tests?\.java$/.test(base);
}

// ── Ground truth: error handling from syntax trees (try/except, try/catch, .catch()) ─
function jsHasErrorHandling(file, content) {
  const kind = /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, kind);
  let found = false;
  (function visit(node) {
    if (found) return;
    if (ts.isTryStatement(node) ||
        (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch')) {
      found = true; return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return found;
}
function pythonTryMap(files) {
  const list = path.join(WORK, 'py_files.json');
  fs.writeFileSync(list, JSON.stringify(files));
  const res = spawnSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3'] : []), '-I', path.join(HERE, 'py_try.py'), list],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

function fileItems(dbPath, roots) {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT repo_name, file_path, language, has_tests, has_error_handling FROM code_files').all();
  db.close();
  const pyTruth = pythonTryMap(rows.filter(r => r.language === 'Python').map(r => r.file_path));
  return rows.map(r => {
    const rel = path.relative(roots[r.repo_name], r.file_path).split(path.sep).join('/');
    let err_truth = null;   // null = not scored (language without a parser here, or unparseable)
    if (r.language === 'Python') err_truth = pyTruth[r.file_path].parse_ok ? pyTruth[r.file_path].has_try : null;
    else if (r.language === 'JavaScript' || r.language === 'TypeScript') err_truth = jsHasErrorHandling(r.file_path, fs.readFileSync(r.file_path, 'utf8'));
    return { id: `${r.repo_name}/${rel}`, language: r.language, test_pred: !!r.has_tests, test_truth: isTestFileByConvention(rel),
             err_pred: !!r.has_error_handling, err_truth };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function fileScores(items) {
  const errItems = items.filter(i => i.err_truth !== null);
  const byLang = (sub, pred, truth) => Object.fromEntries([...new Set(sub.map(i => i.language))].sort()
    .map(l => [l, prf(sub.filter(i => i.language === l), pred, truth)]));
  return {
    tests: { overall: prf(items, i => i.test_pred, i => i.test_truth), by_language: byLang(items, i => i.test_pred, i => i.test_truth) },
    error_handling: { overall: prf(errItems, i => i.err_pred, i => i.err_truth), by_language: byLang(errItems, i => i.err_pred, i => i.err_truth),
                      not_scored: items.length - errItems.length },
  };
}

// ── Commit classifier vs Conventional Commits labels (complete histories) ─────────
const CC_MAP = { feat: 'feature', fix: 'bugfix', refactor: 'refactoring', test: 'test', tests: 'test', docs: 'docs' };
const CLASSES = ['feature', 'bugfix', 'refactoring', 'test', 'docs'];
function commitItems(roots) {
  // Older DevLens versions cap git log at 1 MB; read complete histories here so both versions see the same commits.
  const cp = require('child_process');
  const orig = { execSync: cp.execSync, execFileSync: cp.execFileSync };
  cp.execSync = (cmd, opts) => orig.execSync(cmd, { ...opts, maxBuffer: 1 << 30 });
  cp.execFileSync = (file, args, opts) => orig.execFileSync(file, args, { ...opts, maxBuffer: 1 << 30 });
  const dbPath = path.join(WORK, 'full_history.db');
  rmDb(dbPath);
  const db = initDB(dbPath);
  try {
    for (const [repo, root] of Object.entries(roots)) parseGitHistory(root, repo, db);
  } finally {
    Object.assign(cp, orig);
  }
  const rows = db.prepare('SELECT repo_name, commit_hash, message, additions, deletions, change_type FROM git_commits').all();
  db.close();
  const items = [];
  for (const r of rows) {
    const m = r.message.match(/^(\w+)(\([^)]*\))?!?:\s*(.+)$/);
    if (!m || !CC_MAP[m[1].toLowerCase()]) continue;
    items.push({ id: `${r.repo_name}/${r.commit_hash}`, label: CC_MAP[m[1].toLowerCase()],
                 pred_full: r.change_type, pred_description_only: classifyCommit(m[3], r.additions, r.deletions).change_type });
  }
  return { total_commits: rows.length, items: items.sort((a, b) => a.id.localeCompare(b.id)) };
}

function commitScores({ total_commits, items }) {
  const summarize = key => {
    const per_class = {};
    for (const c of CLASSES) {
      const p = prf(items, i => i[key] === c, i => i.label === c);
      per_class[c] = { support: p.tp + p.fn, precision: p.precision, recall: p.recall, f1: p.f1 };
    }
    const confusion = {};
    for (const i of items) { confusion[i.label] ??= {}; confusion[i.label][i[key]] = (confusion[i.label][i[key]] || 0) + 1; }
    return { accuracy: ratio(items.filter(i => i[key] === i.label).length, items.length),
             macro_f1: CLASSES.reduce((s, c) => s + (per_class[c].f1 ?? 0), 0) / CLASSES.length, per_class, confusion };
  };
  const counts = {};
  for (const i of items) counts[i.label] = (counts[i.label] || 0) + 1;
  const [label, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { total_commits, conventional_labelled: items.length, label_counts: counts,
           majority_baseline: { label, accuracy: n / items.length },
           description_only: summarize('pred_description_only'), full_message: summarize('pred_full') };
}

// ── Robustness: the same repo scanned through a parent folder whose name contains "test" ─
function pathSensitivity(repoRoot) {
  const link = path.join(WORK, 'latest-projects', path.basename(repoRoot));
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (!fs.existsSync(link)) fs.symlinkSync(repoRoot, link, 'junction');
  const rate = root => {
    const dbPath = path.join(WORK, 'path_check.db');
    rmDb(dbPath);
    const db = initDB(dbPath);
    scanRepo(root, 'x', db);
    const r = db.prepare('SELECT COUNT(*) n, SUM(has_tests) t FROM code_files').get();
    db.close();
    return { files: r.n, flagged_as_tests: r.t };
  };
  try {
    return { repo: path.basename(repoRoot), original_path: rate(repoRoot), via_latest_projects: rate(link) };
  } finally {
    fs.rmSync(link); // removes the junction only, never the target
  }
}

// ── LLM report: latency and whether the numbers it cites appear in its input ───────
function numbersIn(text) {
  const cleaned = text.split('\n').map(l => l.replace(/^\s*\d+\.\s+/, '')).join('\n')   // list enumerations
    .replace(/\b\d+\s*\/\s*10\b/g, ' ');                                                  // "8/10" self-ratings
  return [...cleaned.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?%?/g)].map(m => m[0]);
}
function groundingCheck(report, summary) {
  const known = new Set();
  const addNum = v => { if (typeof v === 'number' && isFinite(v)) { known.add(String(v)); known.add(v.toFixed(1)); known.add(String(Math.round(v))); } };
  (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); else if (typeof x === 'number') addNum(x); else if (typeof x === 'string') (x.match(/\d+(?:\.\d+)?/g) || []).forEach(s => addNum(Number(s))); })(summary);
  const derived = new Set();
  const addPct = (a, b) => { if (b) { const p = (100 * a) / b; derived.add(p.toFixed(1)); derived.add(String(Math.round(p))); } };
  for (const l of summary.byLanguage) { addPct(l.files_with_tests, l.files); addPct(l.files_with_error_handling, l.files); addPct(l.files_with_type_hints, l.files); }
  for (const c of summary.commitTypes) addPct(c.count, summary.overview.totalCommits);
  const claims = numbersIn(report).map(raw => {
    const v = raw.replace(/[,%]/g, '');
    const status = known.has(String(Number(v))) || known.has(v) ? 'in_input' : derived.has(String(Number(v))) || derived.has(v) ? 'derived_correctly' : 'not_in_input';
    return { raw, status };
  });
  const count = s => claims.filter(c => c.status === s).length;
  return { numeric_claims: claims.length, in_input: count('in_input'), derived_correctly: count('derived_correctly'),
           not_in_input: count('not_in_input'), not_in_input_values: claims.filter(c => c.status === 'not_in_input').map(c => c.raw) };
}

async function llmRuns(dbPath, n) {
  const { analyze } = R('./src/analyze.ts');
  const { Ollama } = R('ollama');
  const calls = [];
  const orig = Ollama.prototype.chat;
  Ollama.prototype.chat = async function (req) { const res = await orig.call(this, req); calls.push({ request: req, response: res }); return res; };
  const runs = [];
  try {
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime.bigint();
      const text = await analyze(dbPath);
      const wallMs = ms(t0);
      const { request, response: r } = calls[calls.length - 1];
      const summary = JSON.parse(request.messages[0].content.split('## Repository Summary')[1].split('## Your Task')[0]);
      runs.push({ run: i + 1, model: request.model, analyze_wall_ms: wallMs, prompt_tokens: r.prompt_eval_count, output_tokens: r.eval_count,
                  load_ms: r.load_duration / 1e6, output_tokens_per_s: r.eval_count / (r.eval_duration / 1e9),
                  grounding: groundingCheck(text, summary), report_markdown: text });
      const g = runs.at(-1).grounding;
      console.log(`  LLM run ${i + 1}: ${(wallMs / 1000).toFixed(1)} s, ${r.eval_count} tokens, ${g.in_input + g.derived_correctly}/${g.numeric_claims} numbers grounded`);
    }
  } finally {
    Ollama.prototype.chat = orig;
  }
  return runs;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const results = { ran_at: new Date().toISOString(), devlens: DEVLENS, devlens_commit: gitOut(['rev-parse', 'HEAD'], DEVLENS) || null,
                    node: process.version, sets: {} };
  for (const set of SETS) {
    const scan = timedScans(set, path.join(CORPUS, set));
    const files = fileItems(scan.dbPath, scan.roots);
    const commits = commitItems(scan.roots);
    results.sets[set] = { performance: scan.summary, scores: fileScores(files), commits: commitScores(commits),
                          items: { files, commits: commits.items } };
  }
  if (PERSONAL) {
    const scan = timedScans('personal', PERSONAL);
    results.sets.personal = { performance: scan.summary, scores: fileScores(fileItems(scan.dbPath, scan.roots)) };
    const firstRepo = Object.values(scan.roots)[0];
    results.path_sensitivity = pathSensitivity(firstRepo);
    if (LLM_RUNS) {
      console.log(`LLM: ${LLM_RUNS} run(s) of analyze() on the personal corpus`);
      results.llm = await llmRuns(scan.dbPath, LLM_RUNS);
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(results)); // per-item arrays make this large; compare.js writes the readable summary
  console.log(`wrote ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
