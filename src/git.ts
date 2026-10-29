import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';

// Node's default 1 MB buffer silently truncated large histories to 0 commits
const GIT_LOG_MAX_BUFFER = 1024 * 1024 * 1024;

const CONVENTIONAL_TYPES: Record<string, string> = {
  feat: 'feature', fix: 'bugfix', refactor: 'refactoring', test: 'test', tests: 'test', docs: 'docs',
};

export function classifyCommit(message: string, additions: number, deletions: number) {
  // Conventional Commits ("fix(scope): ...") state the type explicitly; other prefixes fall through to keywords
  const conventional = message.match(/^(\w+)(\([^)]*\))?!?:\s*(.*)$/);
  const declared = conventional ? CONVENTIONAL_TYPES[conventional[1].toLowerCase()] : undefined;
  const msg = (conventional ? conventional[3] : message).toLowerCase();

  // Bug fixes are often phrased as the symptom ("crash when X", "should not Y") rather than with the word "fix"
  const isBugfix = /\bfix(e[sd]|ing)?\b|\bbugs?\b|\bcrash|\bbroken\b|\berrors?\b|\bissues?\b|\bpatch\b|\bregression\b|\bresolve[sd]?\b|\bhandle[sd]?\b|\bprevent|\bavoid|\bcorrect(ly)?\b|\bincorrect|\bwrong\b|\bmissing\b|\bfail|\binvalid\b|\bwhen\b|\bshould\b|\bnot\b|\bdon'?t\b/.test(msg);
  const isTestFocused = /\btests?\b|\bspecs?\b|\bcoverage\b|\bassert/.test(msg);
  const isDocs = /\bdocs?\b|\breadme\b|\bdocumentation\b|\bcomments?\b|\bchangelog\b|\btypos?\b|\bjsdoc\b|\bdocstrings?\b/.test(msg);
  const isRefactoring = /\brefactor|\bclean|\bsimplif|\brestructur|\breorgani|\brename|\bmove\b/.test(msg);

  // Keyword-only: a deletion-heavy diff said little about intent (most such commits were fixes or docs edits)
  let change_type = declared;
  if (!change_type) {
    if (isTestFocused) change_type = 'test';
    else if (isDocs) change_type = 'docs';
    else if (isBugfix) change_type = 'bugfix';
    else if (isRefactoring) change_type = 'refactoring';
    else change_type = 'feature';
  }

  return {
    change_type,
    is_refactoring: change_type === 'refactoring' || isRefactoring ? 1 : 0,
    is_bugfix: change_type === 'bugfix' || isBugfix ? 1 : 0,
    is_test_focused: change_type === 'test' || isTestFocused ? 1 : 0,
  };
}

export function parseGitHistory(repoPath: string, repoName: string, db: Database.Database) {
  let logOutput: string;
  try {
    logOutput = execFileSync(
      'git', ['log', '--numstat', '--format=^^^%H|%ae|%an|%ai|%s'],
      { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: GIT_LOG_MAX_BUFFER }
    );
  } catch (err: any) {
    console.warn(`\n  warning: could not read git history for ${repoName}: ${err.code ?? err.message}`);
    return 0;
  }

  const insert = db.prepare(`
    INSERT INTO git_commits (
      repo_name, commit_hash, author_email, author_name, commit_date,
      message, files_changed, additions, deletions, change_type,
      is_refactoring, is_bugfix, is_test_focused
    ) VALUES (
      @repo_name, @commit_hash, @author_email, @author_name, @commit_date,
      @message, @files_changed, @additions, @deletions, @change_type,
      @is_refactoring, @is_bugfix, @is_test_focused
    )
  `);

  const blocks = logOutput.split(/\^\^\^/).filter(b => b.trim());
  let count = 0;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0];
    const parts = header.split('|');
    if (parts.length < 5) continue;

    const [commit_hash, author_email, author_name, commit_date, ...msgParts] = parts;
    const message = msgParts.join('|').trim();

    let additions = 0, deletions = 0, files_changed = 0;
    for (const line of lines.slice(1)) {
      const match = line.match(/^(\d+)\s+(\d+)\s+/);
      if (match) {
        additions += parseInt(match[1]);
        deletions += parseInt(match[2]);
        files_changed++;
      }
    }

    const classification = classifyCommit(message, additions, deletions);

    insert.run({
      repo_name: repoName,
      commit_hash: commit_hash.trim(),
      author_email: author_email.trim(),
      author_name: author_name.trim(),
      commit_date: commit_date.trim(),
      message: message.slice(0, 500),
      files_changed,
      additions,
      deletions,
      ...classification,
    });

    count++;
  }

  return count;
}
