# DevLens

**Understand your coding habits. Locally. For free.**

DevLens scans your local GitHub repos and git history, detects patterns in your code, and generates a personalized report — all on your machine. Nothing is uploaded anywhere.

---

## What It Does

Point it at a folder with your projects and it will tell you:

- Which languages you're strongest in
- Where you're missing error handling or tests
- How your code quality has changed over time
- Which of your repos are worth showing to employers

---

## What You Need Before Starting

Install these if you don't have them:

| Tool | Check if installed | Install |
|---|---|---|
| Node.js (v18+) | `node --version` | [nodejs.org](https://nodejs.org) |
| Git | `git --version` | [git-scm.com](https://git-scm.com) |
| Ollama | `ollama --version` | [ollama.com](https://ollama.com) |

After installing Ollama, pull the AI model (one time only):
```bash
ollama pull llama3
```

---

## Setup (One Time)

**1. Download the project**
```bash
git clone https://github.com/soham842op/Devlens.git
cd Devlens
```

**2. Install dependencies**
```bash
npm install
```

That's it. No API keys. No accounts. No cloud.

---

## How to Run

**1. Make sure Ollama is running**

Open the Ollama app on your computer (it runs in the background). You'll see it in your system tray.

**2. Open a terminal inside the Devlens folder**

Right-click the `Devlens` folder → "Open in Terminal"

**3. Run the analysis**

Point it at whichever folder contains your projects:

```bash
npm run dev "C:\Users\YourName\Desktop\Projects"
```

On Mac/Linux:
```bash
npm run dev "/home/yourname/projects"
```

**4. Wait ~1-3 minutes**

It will:
- Scan all your repos (fast)
- Read your git history (fast)
- Ask the local AI to analyze the patterns (takes a minute)

**5. Open the report**

When it's done, open `report.html` (inside the Devlens folder) in your browser.

---

## Example Output

```
DevLens — Local Code Analysis
──────────────────────────────────────────────────
Scanning: C:\Users\soham\Desktop\Projects

Found 8 repo(s):

  MarketMind... 124 files, 312 commits
  PhoenixCore... 87 files, 201 commits
  BankNiftyBot... 43 files, 98 commits
  ...

──────────────────────────────────────────────────
Scanned: 680 files | 1,240 commits | 8 repos

Calling local AI for analysis...

──────────────────────────────────────────────────
Report saved: C:\Users\soham\Desktop\Devlens\report.html
```

---

## Privacy

- Your code never leaves your computer
- The AI (Ollama/llama3) runs fully locally
- No internet connection needed after setup
- No accounts, no API keys, no tracking

---

## Tech Stack

- TypeScript + Node.js
- SQLite (local database)
- Ollama + llama3 (local AI)
- HTML report output

---

## License

MIT — free to use, modify, and share.
