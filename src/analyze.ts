import Database from 'better-sqlite3';
import { Ollama } from 'ollama';

interface LanguageStat {
  language: string;
  files: number;
  total_lines: number;
  files_with_tests: number;
  files_with_error_handling: number;
  files_with_type_hints: number;
  avg_function_length: number;
}

interface CommitStat {
  change_type: string;
  count: number;
}

interface RepoStat {
  repo_name: string;
  files: number;
  total_lines: number;
}

interface WeakFile {
  repo_name: string;
  file_path: string;
  language: string;
  functions_count: number;
}

function buildSummary(db: Database.Database) {
  const totalFiles = (db.prepare('SELECT COUNT(*) as n FROM code_files').get() as { n: number }).n;
  const totalLines = (db.prepare('SELECT SUM(lines_of_code) as n FROM code_files').get() as { n: number }).n || 0;
  const totalRepos = (db.prepare('SELECT COUNT(DISTINCT repo_name) as n FROM code_files').get() as { n: number }).n;
  const totalCommits = (db.prepare('SELECT COUNT(*) as n FROM git_commits').get() as { n: number }).n;

  // Language breakdown
  const byLanguage = db.prepare(`
    SELECT
      language,
      COUNT(*) as files,
      SUM(lines_of_code) as total_lines,
      SUM(has_tests) as files_with_tests,
      SUM(has_error_handling) as files_with_error_handling,
      SUM(has_type_hints) as files_with_type_hints,
      ROUND(AVG(avg_function_length), 1) as avg_function_length
    FROM code_files
    GROUP BY language
    ORDER BY files DESC
  `).all() as LanguageStat[];

  // Commit type breakdown
  const commitTypes = db.prepare(`
    SELECT change_type, COUNT(*) as count
    FROM git_commits
    GROUP BY change_type
    ORDER BY count DESC
  `).all() as CommitStat[];

  // Per-repo summary
  const byRepo = db.prepare(`
    SELECT repo_name, COUNT(*) as files, SUM(lines_of_code) as total_lines
    FROM code_files
    GROUP BY repo_name
    ORDER BY total_lines DESC
  `).all() as RepoStat[];

  // Overall code quality rates
  const errorHandlingRate = db.prepare(`
    SELECT ROUND(AVG(has_error_handling) * 100, 1) as rate FROM code_files
  `).get() as { rate: number };

  const testRate = db.prepare(`
    SELECT ROUND(AVG(has_tests) * 100, 1) as rate FROM code_files
  `).get() as { rate: number };

  const typeHintRate = db.prepare(`
    SELECT ROUND(AVG(has_type_hints) * 100, 1) as rate FROM code_files
  `).get() as { rate: number };

  const avgFuncLength = db.prepare(`
    SELECT ROUND(AVG(avg_function_length), 1) as avg FROM code_files WHERE avg_function_length > 0
  `).get() as { avg: number };

  // Worst offenders — files with functions but no error handling
  const weakFiles = db.prepare(`
    SELECT repo_name, file_path, language, functions_count
    FROM code_files
    WHERE has_error_handling = 0 AND functions_count > 2
    ORDER BY functions_count DESC
    LIMIT 10
  `).all() as WeakFile[];

  // Git velocity: commits per month
  const monthlyVelocity = db.prepare(`
    SELECT
      strftime('%Y-%m', commit_date) as month,
      COUNT(*) as commits,
      SUM(additions) as lines_added,
      SUM(deletions) as lines_removed
    FROM git_commits
    WHERE commit_date IS NOT NULL
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();

  // Author breakdown
  const authors = db.prepare(`
    SELECT author_name, author_email, COUNT(*) as commits
    FROM git_commits
    WHERE author_name IS NOT NULL
    GROUP BY author_email
    ORDER BY commits DESC
    LIMIT 5
  `).all();

  return {
    overview: { totalRepos, totalFiles, totalLines, totalCommits },
    quality: {
      errorHandlingRate: errorHandlingRate.rate || 0,
      testRate: testRate.rate || 0,
      typeHintRate: typeHintRate.rate || 0,
      avgFunctionLength: avgFuncLength.avg || 0,
    },
    byLanguage,
    byRepo,
    commitTypes,
    monthlyVelocity,
    authors,
    weakFiles,
  };
}

export async function analyze(dbPath: string): Promise<string> {
  const db = new Database(dbPath, { readonly: true });
  const summary = buildSummary(db);
  db.close();

  if (summary.overview.totalFiles === 0) {
    throw new Error('No code files found in database. Run the scanner first.');
  }

  const ollama = new Ollama();

  const prompt = `You are analyzing a developer's local code repositories. Below is a statistical summary extracted from their code and git history. Generate a detailed, honest, personalized code analysis report.

## Repository Summary

${JSON.stringify(summary, null, 2)}

## Your Task

Write a comprehensive developer report with these sections:

1. **Executive Summary** — 2-3 sentences overall assessment. Be direct and honest.

2. **Strengths** — What this developer does well (with specific evidence from the data).

3. **Weaknesses & Patterns to Fix** — Recurring issues, prioritized by severity. Reference specific repos/files where relevant.

4. **Language Breakdown** — For each language: confidence level, test coverage, error handling, and one key recommendation.

5. **Git & Work Habits** — What their commit patterns reveal about how they work.

6. **Growth Recommendations** — 3 specific, actionable next steps. Not generic advice — tied to their actual data.

7. **Repos to Show Employers** — Which repos are strongest and why.

Rules:
- Be specific, not generic. Reference actual numbers from the data.
- Be honest. If something is weak, say so clearly.
- Keep each section concise — no fluff.
- Format with markdown headers and bullet points.`;

  const response = await ollama.chat({
    model: 'llama3',
    messages: [{ role: 'user', content: prompt }],
  });

  return response.message.content;
}
