import path from 'path';
import { initDB } from './db';
import { findRepos, scanRepo } from './scanner';
import { parseGitHistory } from './git';
import { analyze } from './analyze';
import { generateReport } from './report';

const rootDir = process.argv[2];

if (!rootDir) {
  console.error('Usage: npm run dev <path-to-projects-folder>');
  console.error('Example: npm run dev "C:/Users/soham/Desktop/Projects"');
  process.exit(1);
}

const absoluteRoot = path.resolve(rootDir);
const dbPath = './analysis.db';

async function main() {
  console.log(`\n DevLens — Local Code Analysis`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Scanning: ${absoluteRoot}\n`);

  // Phase 1: Scan
  const db = initDB(dbPath);
  db.exec('DELETE FROM code_files; DELETE FROM git_commits; DELETE FROM detected_patterns;');

  const repos = findRepos(absoluteRoot);
  if (repos.length === 0) {
    console.error('No git repositories found in that directory.');
    process.exit(1);
  }

  console.log(`Found ${repos.length} repo(s):\n`);

  let totalFiles = 0;
  let totalCommits = 0;

  for (const repoPath of repos) {
    const repoName = path.basename(repoPath);
    process.stdout.write(`  ${repoName}...`);
    const files = scanRepo(repoPath, repoName, db);
    const commits = parseGitHistory(repoPath, repoName, db);
    totalFiles += files;
    totalCommits += commits;
    console.log(` ${files} files, ${commits} commits`);
  }

  db.close();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Scanned: ${totalFiles} files | ${totalCommits} commits | ${repos.length} repos`);

  // Phase 2: Analyze
  console.log(`\nCalling Claude for analysis...`);
  let analysisText: string;
  try {
    analysisText = await analyze(dbPath);
  } catch (err: any) {
    console.error(`\nAnalysis failed: ${err.message}`);
    process.exit(1);
  }

  // Phase 3: Report
  const reportPath = path.resolve('./report.html');
  generateReport(analysisText, reportPath);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(` Report saved: ${reportPath}`);
  console.log(`\nOpen report.html in your browser to view the full analysis.\n`);
}

main();
