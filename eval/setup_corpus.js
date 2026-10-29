// Clones the evaluation repos at pinned commits (full history, needed for the commit classifier).
// Usage: node eval/setup_corpus.js [targetDir]   (default: eval/corpus)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const target = path.resolve(process.argv[2] || path.join(__dirname, 'corpus'));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
const git = (args, cwd) => execFileSync('git', ['-c', 'core.longpaths=true', ...args], { cwd, stdio: 'inherit' });

for (const [set, repos] of Object.entries(corpus)) {
  for (const repo of repos) {
    const dir = path.join(target, set, repo.name);
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      git(['clone', '-q', repo.url, dir]);
    }
    git(['checkout', '-q', '--detach', repo.commit], dir);
    console.log(`${set}/${repo.name} @ ${repo.commit.slice(0, 9)}`);
  }
}
