const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const evidence = path.join(__dirname, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const environment = { ...process.env, NO_COLOR: '1' };
delete environment.FORCE_COLOR;

// Runs a command and keeps its genuine output for the report.
function run(command, args, name) {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: 'utf8' });
  fs.writeFileSync(path.join(evidence, `${name}.txt`), (result.stdout || '') + (result.stderr || ''));
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  return result;
}

// Builds the API and runs exactly six Jest units plus twelve Node cases.
const build = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], 'build');
if (build.status !== 0) process.exit(build.status || 1);
const jestArgs = [require.resolve('jest/bin/jest'), '--config', 'assignment-testing/jest.config.cjs', '--runInBand', '--verbose', '--json', '--outputFile=assignment-testing/evidence/jest-results.json'];
const jest = run(process.execPath, jestArgs, 'jest-run');
const nodeArgs = ['--test', '--test-reporter=tap', 'assignment-testing/unit.test.cjs', 'assignment-testing/components.test.cjs'];
const node = run(process.execPath, nodeArgs, 'node-run');
const jestResults = JSON.parse(fs.readFileSync(path.join(evidence, 'jest-results.json'), 'utf8'));

// Collects actual observations and pass/fail outcomes from both test runners.
const cases = [];
for (const line of [jest.stdout, jest.stderr, node.stdout].join('\n').split('\n')) {
  const match = line.match(/(\{"id":.*\})\s*$/);
  if (match) cases.push(JSON.parse(match[1]));
}
const outcomes = jestResults.testResults.flatMap(suite => suite.assertionResults.map(test => ({
  id: test.title.split(' ')[0], name: test.title, passed: test.status === 'passed',
})));
for (const match of (node.stdout || '').matchAll(/^\s*(ok|not ok) \d+ - ((?:U[34]|C[12])-\d\d .+)$/gm)) {
  outcomes.push({ id: match[2].split(' ')[0], name: match[2], passed: match[1] === 'ok' });
}
const tests = outcomes.length;
const pass = outcomes.filter(test => test.passed).length;
const skipped = jestResults.numPendingTests + Number((node.stdout || '').match(/^# skipped (\d+)$/m)?.[1] || 0);
const status = jest.status || node.status || 0;
const summary = { tests, pass, fail: tests - pass, skipped, units: 12, components: 6 };
fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({
  command: 'node assignment-testing/run.cjs',
  runnerCommand: 'Jest: assignment-testing/jest.config.cjs; Node: unit.test.cjs + components.test.cjs',
  executedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  status, summary, cases, outcomes,
}, null, 2) + '\n');
console.log(`\nAssignment: ${tests} tests; ${pass} passed; ${tests - pass} failed; ${skipped} skipped.`);
console.log('Selected groups: 12 unit tests and 6 component tests.');
const expected = require('./cases.json').map(test => test.id).sort().join(',');
const ids = outcomes.map(test => test.id).sort().join(',');
if (status !== 0 || tests !== 18 || skipped !== 0 || ids !== expected || cases.length !== 18) process.exit(1);
