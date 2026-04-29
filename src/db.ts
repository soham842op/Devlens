import Database from 'better-sqlite3';
import path from 'path';

export function initDB(dbPath: string = './analysis.db') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS code_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,
      lines_of_code INTEGER DEFAULT 0,
      functions_count INTEGER DEFAULT 0,
      classes_count INTEGER DEFAULT 0,
      imports_count INTEGER DEFAULT 0,
      has_tests INTEGER DEFAULT 0,
      has_error_handling INTEGER DEFAULT 0,
      has_type_hints INTEGER DEFAULT 0,
      has_docstrings INTEGER DEFAULT 0,
      has_comments INTEGER DEFAULT 0,
      max_function_length INTEGER DEFAULT 0,
      avg_function_length REAL DEFAULT 0,
      nesting_depth INTEGER DEFAULT 0,
      comment_ratio REAL DEFAULT 0,
      last_modified TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS git_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_name TEXT NOT NULL,
      commit_hash TEXT NOT NULL,
      author_email TEXT,
      author_name TEXT,
      commit_date TEXT,
      message TEXT,
      files_changed INTEGER DEFAULT 0,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      change_type TEXT,
      is_refactoring INTEGER DEFAULT 0,
      is_bugfix INTEGER DEFAULT 0,
      is_test_focused INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS detected_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_type TEXT NOT NULL,
      repo_name TEXT,
      frequency INTEGER DEFAULT 0,
      severity TEXT,
      evidence TEXT,
      recommendation TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_files_repo ON code_files(repo_name);
    CREATE INDEX IF NOT EXISTS idx_files_lang ON code_files(language);
    CREATE INDEX IF NOT EXISTS idx_commits_repo ON git_commits(repo_name);
    CREATE INDEX IF NOT EXISTS idx_commits_date ON git_commits(commit_date);
  `);

  return db;
}
