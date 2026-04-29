import path from 'path';
import { initDB } from './db';
import { findRepos, scanRepo } from './scanner';
import { parseGitHistory } from './git';

const rootDir = process.argv[2];

if (!rootDir) {
  console.error('Usage: npm run dev <path-to-projects-folder>');
  console.error('Example: npm run dev ~/projects');
  process.exit(1);
}

const absoluteRoot = path.resolve(rootDir);
console.log(`\nScanning: ${absoluteRoot}\n`);

const db = initDB('./analysis.db');

// Clear previous data
db.exec('DELETE FROM code_files; DELETE FROM git_commits; DELETE FROM detected_patterns;');

const repos = findRepos(absoluteRoot);
console.log(`Found ${repos.length} repo(s):\n`);

let totalFiles = 0;
let totalCommits = 0;

for (const repoPath of repos) {
  const repoName = path.basename(repoPath);
  process.stdout.write(`  Scanning ${repoName}...`);

  const files = scanRepo(repoPath, repoName, db);
  const commits = parseGitHistory(repoPath, repoName, db);

  totalFiles += files;
  totalCommits += commits;

  console.log(` ${files} files, ${commits} commits`);
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${totalFiles} files | ${totalCommits} commits | ${repos.length} repos`);
console.log(`Database saved: ./analysis.db`);
console.log(`\nNext: Run analysis with Claude to generate report.`);

db.close();
