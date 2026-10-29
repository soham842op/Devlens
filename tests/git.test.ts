import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { initDB } from '../src/db';
import { classifyCommit, parseGitHistory } from '../src/git';

describe('classifyCommit', () => {
  it.each([
    ['fix(parser): handle empty input', 'bugfix'],
    ['feat!: drop Node 16 support', 'feature'],
    ['docs: remove outdated install section', 'docs'],
    ['refactor: split scanner into modules', 'refactoring'],
    ['test: cover path edge cases', 'test'],
  ])('uses the Conventional Commits type in %j', (message, expected) => {
    // Large deletions must not override a declared type
    expect(classifyCommit(message, 10, 500).change_type).toBe(expected);
  });

  it.each([
    ['Fix crash when config is missing', 'bugfix'],
    ['Update README with setup steps', 'docs'],
    ['Add unit tests for the tokenizer', 'test'],
    ['Simplify the retry loop', 'refactoring'],
    ['Add dark mode toggle', 'feature'],
  ])('classifies %j by keyword', (message, expected) => {
    expect(classifyCommit(message, 100, 20).change_type).toBe(expected);
  });

  it('lets keywords win over the deletion ratio', () => {
    // Regression: deletions > 0.6 * additions used to label most fixes and docs edits as refactoring
    expect(classifyCommit('Fix off-by-one in pagination', 5, 40).change_type).toBe('bugfix');
    expect(classifyCommit('Remove stale docs', 0, 300).change_type).toBe('docs');
  });

  it.each([
    ['Handle empty input in parser', 'bugfix'],
    ['Should not reload the page on CSS change', 'bugfix'],
    ['Avoid duplicate requests when retrying', 'bugfix'],
    ['Fix typo in README', 'docs'],
  ])('reads %j by intent, not diff size', (message, expected) => {
    expect(classifyCommit(message, 3, 400).change_type).toBe(expected);
  });

  it('matches whole words only', () => {
    // "prefix" contains "fix", "latest" contains "test"
    expect(classifyCommit('Add prefix option to latest exporter', 50, 5).change_type).toBe('feature');
  });
});

describe('parseGitHistory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devlens-git-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('parses a history whose git log output is larger than 1 MB', () => {
    // Regression: execSync's default 1 MB maxBuffer made large repos report 0 commits with no error
    const repo = path.join(tmp, 'big');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });

    const commits = 12000;
    const chunks: string[] = [];
    for (let i = 1; i <= commits; i++) {
      const msg = `feat: add generated entry number ${i} to the fixture file`;
      const data = `line ${i}\n`;
      chunks.push(
        'commit refs/heads/main\n' +
        `committer Dev Lens <devlens@example.com> ${1700000000 + i} +0000\n` +
        `data ${Buffer.byteLength(msg)}\n${msg}\n` +
        `M 644 inline file${i % 50}.txt\ndata ${Buffer.byteLength(data)}\n${data}\n`,
      );
    }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, input: chunks.join('') });

    const logBytes = execFileSync('git', ['log', '--numstat', '--format=^^^%H|%ae|%an|%ai|%s', 'main'], {
      cwd: repo, maxBuffer: 1 << 30,
    }).length;
    expect(logBytes).toBeGreaterThan(1024 * 1024);

    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: repo });
    const db = initDB(':memory:');
    expect(parseGitHistory(repo, 'big', db)).toBe(commits);
    const types = db.prepare('SELECT DISTINCT change_type FROM git_commits').all();
    db.close();
    expect(types).toEqual([{ change_type: 'feature' }]);
  }, 60_000);
});
