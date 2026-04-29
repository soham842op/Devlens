import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const CODE_EXTENSIONS: Record<string, string> = {
  '.py': 'Python',
  '.js': 'JavaScript',
  '.ts': 'TypeScript',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.cpp': 'C++',
  '.c': 'C',
  '.rb': 'Ruby',
  '.cs': 'C#',
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', 'vendor']);

export function findRepos(rootDir: string): string[] {
  const repos: string[] = [];

  function scan(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasGit = entries.some(e => e.isDirectory() && e.name === '.git');
    if (hasGit) {
      repos.push(dir);
      return; // don't scan inside a repo for nested repos
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        scan(path.join(dir, entry.name));
      }
    }
  }

  scan(rootDir);
  return repos;
}

export function extractMetrics(filePath: string, content: string, language: string) {
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);

  // Function detection patterns per language
  const functionPatterns: Record<string, RegExp> = {
    Python: /^\s*def\s+\w+/,
    JavaScript: /function\s+\w+|const\s+\w+\s*=\s*(\(|async\s*\()|=>\s*\{/,
    TypeScript: /function\s+\w+|const\s+\w+\s*=\s*(\(|async\s*\()|=>\s*\{/,
    Go: /^func\s+/,
    Rust: /^(pub\s+)?fn\s+/,
    Java: /(public|private|protected|static).*\w+\s*\(/,
  };

  const funcPattern = functionPatterns[language];
  const functionLines = funcPattern ? lines.filter(l => funcPattern.test(l)) : [];

  const importPatterns: Record<string, RegExp> = {
    Python: /^(import|from)\s+/,
    JavaScript: /^(import|require\()/,
    TypeScript: /^import\s+/,
    Go: /^\s*"[\w/]+"/, // inside import block
  };
  const importPattern = importPatterns[language];
  const importLines = importPattern ? lines.filter(l => importPattern.test(l)) : [];

  const commentLines = lines.filter(l => {
    const t = l.trim();
    return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*');
  });

  const hasErrorHandling = /try|catch|except|error|err\s*!=\s*nil|Result<|unwrap_or/.test(content);
  const hasTests = filePath.includes('test') || filePath.includes('spec') ||
    /describe\(|it\(|def test_|#\[test\]|@Test/.test(content);
  const hasTypeHints = language === 'TypeScript' ||
    /:\s*(str|int|float|bool|List|Dict|Optional|Any)\b/.test(content) ||
    /->/.test(content);
  const hasDocstrings = /"""[\s\S]*?"""|\/\*\*[\s\S]*?\*\//.test(content);
  const hasComments = commentLines.length > 0;

  // Rough nesting depth
  let maxDepth = 0, currentDepth = 0;
  for (const line of lines) {
    const open = (line.match(/[\{\(]/g) || []).length;
    const close = (line.match(/[\}\)]/g) || []).length;
    currentDepth += open - close;
    if (currentDepth > maxDepth) maxDepth = currentDepth;
    if (currentDepth < 0) currentDepth = 0;
  }

  const linesPerFunc = functionLines.length > 0
    ? Math.round(nonEmptyLines.length / functionLines.length)
    : 0;

  return {
    lines_of_code: nonEmptyLines.length,
    functions_count: functionLines.length,
    classes_count: (content.match(/^(class|struct|interface)\s+/gm) || []).length,
    imports_count: importLines.length,
    has_tests: hasTests ? 1 : 0,
    has_error_handling: hasErrorHandling ? 1 : 0,
    has_type_hints: hasTypeHints ? 1 : 0,
    has_docstrings: hasDocstrings ? 1 : 0,
    has_comments: hasComments ? 1 : 0,
    max_function_length: linesPerFunc,
    avg_function_length: linesPerFunc,
    nesting_depth: maxDepth,
    comment_ratio: nonEmptyLines.length > 0
      ? parseFloat((commentLines.length / nonEmptyLines.length).toFixed(2))
      : 0,
  };
}

export function scanRepo(repoPath: string, repoName: string, db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO code_files (
      repo_name, file_path, language, lines_of_code, functions_count,
      classes_count, imports_count, has_tests, has_error_handling,
      has_type_hints, has_docstrings, has_comments, max_function_length,
      avg_function_length, nesting_depth, comment_ratio, last_modified
    ) VALUES (
      @repo_name, @file_path, @language, @lines_of_code, @functions_count,
      @classes_count, @imports_count, @has_tests, @has_error_handling,
      @has_type_hints, @has_docstrings, @has_comments, @max_function_length,
      @avg_function_length, @nesting_depth, @comment_ratio, @last_modified
    )
  `);

  let fileCount = 0;

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const language = CODE_EXTENSIONS[ext];
        if (!language) continue;

        let content: string;
        try {
          content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }

        const stats = fs.statSync(fullPath);
        const metrics = extractMetrics(fullPath, content, language);

        insert.run({
          repo_name: repoName,
          file_path: fullPath,
          language,
          last_modified: stats.mtime.toISOString(),
          ...metrics,
        });

        fileCount++;
      }
    }
  }

  walk(repoPath);
  return fileCount;
}
