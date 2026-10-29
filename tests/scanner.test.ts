import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { initDB } from '../src/db';
import { extractMetrics, isTestPath, scanRepo } from '../src/scanner';

describe('test detection', () => {
  it.each([
    'tests/test_models.py',
    'app/tests.py',
    'conftest.py',
    'src/__tests__/parse.ts',
    'lib/utils.spec.js',
    'packages/core/src/index.test.tsx',
    'server/handler_test.go',
    'src/test/java/UserServiceTest.java',
  ])('flags %s by path', relPath => {
    expect(isTestPath(relPath)).toBe(true);
  });

  it.each(['src/latest.ts', 'contest/score.py', 'src/attestation.ts', 'lib/specification.js'])(
    'does not flag %s by path',
    relPath => {
      expect(isTestPath(relPath)).toBe(false);
    },
  );

  it('does not treat split( / exit( / init( as test calls', () => {
    const code = 'const parts = line.split(",");\nprocess.exit(1);\napp.init(config);\n';
    expect(extractMetrics('src/cli.ts', code, 'TypeScript').has_tests).toBe(0);
  });

  it('flags describe/it/test calls and pytest functions', () => {
    expect(extractMetrics('src/a.ts', "describe('x', () => { it('works', () => {}) })", 'TypeScript').has_tests).toBe(1);
    expect(extractMetrics('src/a.js', 'test(`adds`, () => {})', 'JavaScript').has_tests).toBe(1);
    expect(extractMetrics('src/a.py', 'def test_adds():\n    assert 1', 'Python').has_tests).toBe(1);
  });
});

describe('error-handling detection', () => {
  it.each([
    ['TypeScript', 'try {\n  run();\n} catch (e) {\n  log(e);\n}'],
    ['JavaScript', 'fetch(url).then(r => r.json()).catch(handle);'],
    ['Python', 'try:\n    run()\nexcept ValueError as e:\n    log(e)'],
    ['Go', 'if err != nil {\n\treturn err\n}'],
  ])('flags real %s error handling', (language, code) => {
    expect(extractMetrics('src/x', code, language).has_error_handling).toBe(1);
  });

  it('ignores words that merely contain try/error', () => {
    const code = 'const entry = registry.get(id);\nretry(entry);\nconst errorMessage = "oops";\nfunction country() {}\n';
    expect(extractMetrics('src/x.ts', code, 'TypeScript').has_error_handling).toBe(0);
  });
});

describe('scanRepo', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devlens-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('ignores folders above the repo root when detecting tests', () => {
    // Regression: a parent folder like "latest-projects" used to mark every file as a test
    const repo = path.join(tmp, 'latest-projects', 'app');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'main.py'), 'def main():\n    return 1\n');
    fs.writeFileSync(path.join(repo, 'tests', 'test_main.py'), 'def test_main():\n    assert True\n');

    const db = initDB(':memory:');
    expect(scanRepo(repo, 'app', db)).toBe(2);
    const rows = db.prepare('SELECT file_path, has_tests FROM code_files ORDER BY file_path').all() as
      { file_path: string; has_tests: number }[];
    db.close();
    expect(rows.map(r => [path.relative(repo, r.file_path), r.has_tests])).toEqual([
      [path.join('src', 'main.py'), 0],
      [path.join('tests', 'test_main.py'), 1],
    ]);
  });
});
