import { execSync } from 'child_process';
import Database from 'better-sqlite3';

function classifyCommit(message: string, additions: number, deletions: number) {
  const msg = message.toLowerCase();
  const isRefactoring = /refactor|clean|simplif|restructur|reorgani/.test(msg) || deletions > additions * 0.6;
  const isBugfix = /fix|bug|error|crash|broken|issue|patch/.test(msg);
  const isTestFocused = /test|spec|coverage|assert/.test(msg);

  let change_type = 'feature';
  if (isTestFocused) change_type = 'test';
  else if (isRefactoring) change_type = 'refactoring';
  else if (isBugfix) change_type = 'bugfix';
  else if (/doc|readme|comment|changelog/.test(msg)) change_type = 'docs';

  return { change_type, is_refactoring: isRefactoring ? 1 : 0, is_bugfix: isBugfix ? 1 : 0, is_test_focused: isTestFocused ? 1 : 0 };
}

export function parseGitHistory(repoPath: string, repoName: string, db: Database.Database) {
  let logOutput: string;
  try {
    logOutput = execSync(
      'git log --numstat --format="^^^%H|%ae|%an|%ai|%s"',
      { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
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
