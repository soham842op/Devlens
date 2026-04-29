# DevLens — MCP Code Analysis Instructions

## What This Is
When the user asks to analyze repos, use the Filesystem MCP and Git MCP tools to scan their local code and git history, then generate a personalized developer report.

## MCP Tools Available
- **Filesystem MCP** — read local files and directories
- **Git MCP** — read git log, commits, diffs, and history

## How to Run an Analysis

### Step 1: Discover Repos
Use Filesystem MCP to scan the user's projects folder.
Find all directories that contain a `.git` folder — each is a repo.

### Step 2: Scan Code Files
For each repo, use Filesystem MCP to read source files (.py, .js, .ts, .go, .rs, .java).
Extract per-file metrics:
- Lines of code
- Function count (def, function, const = () =>, func)
- Has error handling? (try/catch/except/err != nil)
- Has tests? (file path contains "test" or uses describe/it/def test_)
- Has type hints? (TypeScript, or Python type annotations)
- Has comments?

### Step 3: Read Git History
For each repo, use Git MCP to get commit history.
Extract:
- Total commits, date range
- Commit messages (classify: feature/bugfix/refactor/test)
- Additions and deletions per commit
- Most active files
- Coding velocity (commits per month)

### Step 4: Detect Patterns
Aggregate across all repos:
- Error handling rate by language
- Test coverage rate by language
- Function length trends
- Commit type breakdown (% feature vs bugfix vs refactor)
- Which repos are strongest

### Step 5: Generate Report
Write a personalized developer report with these sections:

1. **Executive Summary** — honest 2-3 sentence assessment
2. **Strengths** — backed by specific numbers from the data
3. **Weaknesses** — prioritized by severity, with specific file examples
4. **Language Breakdown** — per language: test rate, error handling rate, recommendation
5. **Git & Work Habits** — what commit patterns reveal
6. **Growth Recommendations** — 3 specific actionable next steps
7. **Repos to Show Employers** — top repos and why

## Rules
- Reference actual file names and numbers — no generic advice
- Be honest about weaknesses
- Show improvement trajectory if visible in git history
- Everything stays local — do not upload or share any code

## Usage
User will say something like:
- "Analyze my repos at C:\Users\soham\Desktop\Projects"
- "Scan all my code and tell me my patterns"
- "Generate a DevLens report"
