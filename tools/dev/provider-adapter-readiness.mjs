#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RECEIPT_SCHEMA = 'theseus.dreaming-worker.provider-adapter-readiness.v1';

export function isSupportedNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0)));
}

function mutantsFrom(report) {
  return Object.values(report?.files ?? {}).flatMap(file => file?.mutants ?? []);
}

export function summarizeMutationReport(report) {
  const mutants = mutantsFrom(report);
  const count = status => mutants.filter(mutant => mutant.status === status).length;
  const killed = count('Killed');
  const survived = count('Survived');
  const timeout = count('Timeout');
  const noCoverage = count('NoCoverage');
  const compileError = count('CompileError');
  const ignored = count('Ignored');
  const scored = killed + survived + timeout + noCoverage;

  return {
    total: mutants.length,
    killed,
    survived,
    timeout,
    noCoverage,
    compileError,
    ignored,
    mutationScore: scored === 0 ? null : ((killed + timeout) / scored) * 100,
  };
}

function indexByMutantId(report) {
  const index = new Map();
  for (const mutant of mutantsFrom(report)) {
    if (mutant.id === undefined || mutant.id === null) continue;
    const id = String(mutant.id);
    if (index.has(id)) throw new Error(`duplicate mutant id in report: ${id}`);
    index.set(id, mutant);
  }
  return index;
}

export function compareMutationReports(baseline, current) {
  const before = indexByMutantId(baseline);
  const after = indexByMutantId(current);
  const transitions = {};

  for (const [id, currentMutant] of after) {
    const previous = before.get(id);
    if (!previous || previous.status === currentMutant.status) continue;
    const key = `${previous.status}->${currentMutant.status}`;
    if (!transitions[key]) transitions[key] = [];
    transitions[key].push(id);
  }

  for (const ids of Object.values(transitions)) ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    transitions,
    missingFromCurrent: [...before.keys()].filter(id => !after.has(id)).sort(),
    newInCurrent: [...after.keys()].filter(id => !before.has(id)).sort(),
  };
}

export function buildExecutionReceipt({ head, branch, worktree, steps, baseline, preflight = { status: 'PASS' } }) {
  const ordered = [preflight, steps.focusedTests, steps.canonicalQa, steps.mutation].filter(Boolean);
  const failed = ordered.find(step => step.status === 'FAIL');
  return {
    schema: RECEIPT_SCHEMA,
    head,
    branch,
    worktree,
    preflight,
    executionStatus: failed ? 'FAIL' : 'PASS',
    exitCode: failed ? (failed.exitCode ?? 1) : 0,
    steps,
    baseline,
  };
}

function parseTapCounts(text) {
  const tests = text.match(/^# tests (\d+)$/m)?.[1];
  const pass = text.match(/^# pass (\d+)$/m)?.[1];
  return {
    tests: tests === undefined ? null : Number(tests),
    pass: pass === undefined ? null : Number(pass),
  };
}

function gitText(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export async function runLogged(root, command, args, logPath, env = process.env) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = openSync(logPath, 'w');

  return await new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      closeSync(fd);
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd: root,
        env,
        stdio: ['ignore', fd, fd],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeSync(fd, `spawn error: ${message}\n`);
      finish({ exitCode: 127, spawnError: message });
      return;
    }

    child.once('error', error => {
      const message = error instanceof Error ? error.message : String(error);
      writeSync(fd, `spawn error: ${message}\n`);
      finish({ exitCode: 127, spawnError: message });
    });
    child.once('close', code => finish({ exitCode: code ?? 1, spawnError: null }));
  });
}

export function focusedTestArgs() {
  return ['--test', '--test-reporter=tap', 'test/openai-provider-adapter.test.mjs'];
}

function relativeToRoot(root, filePath) {
  return path.relative(root, filePath) || '.';
}

export function loadBaselineSnapshot(baselinePath) {
  const absolute = path.resolve(baselinePath);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  if (parsed?.files) return { report: parsed, source: absolute };

  if (parsed?.schema === RECEIPT_SCHEMA && parsed?.artifacts?.mutationReport) {
    const reportPath = path.resolve(path.dirname(absolute), parsed.artifacts.mutationReport);
    return { report: JSON.parse(readFileSync(reportPath, 'utf8')), source: absolute };
  }

  throw new Error('baseline must be a Stryker JSON report or readiness receipt with artifacts.mutationReport');
}

function parseArgs(argv) {
  const options = { baseline: null, outputDir: null, expectBranch: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--baseline') options.baseline = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--expect-branch') options.expectBranch = argv[++index];
    else if (arg === '--help') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: tools/dev/provider-adapter-readiness [options]\n\nOptions:\n  --baseline PATH       Prior Stryker JSON report or readiness receipt\n  --output-dir PATH     Receipt/log directory (default: reports/provider-adapter-readiness/<head>)\n  --expect-branch NAME  Fail preflight when the current branch differs\n  --help                Show this help`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  const root = gitText(process.cwd(), ['rev-parse', '--show-toplevel']);
  const head = gitText(root, ['rev-parse', 'HEAD']);
  const branch = gitText(root, ['branch', '--show-current']);
  const porcelain = gitText(root, ['status', '--porcelain=v1']);
  const worktree = porcelain ? 'DIRTY' : 'CLEAN';
  const outputDir = path.resolve(root, options.outputDir ?? `reports/provider-adapter-readiness/${head.slice(0, 12)}`);
  mkdirSync(outputDir, { recursive: true });

  const receiptPath = path.join(outputDir, 'receipt.json');
  const mutationReportPath = path.join(outputDir, 'mutation.json');
  const steps = {
    focusedTests: { status: 'NOT_RUN', exitCode: null, log: 'focused-tests.log' },
    canonicalQa: { status: 'NOT_RUN', exitCode: null, log: 'canonical-qa.log' },
    mutation: { status: 'NOT_RUN', exitCode: null, log: 'mutation.log' },
  };
  let baseline = null;
  let baselineSnapshot = null;

  const preflightProblems = [];
  if (options.baseline) {
    try {
      baselineSnapshot = loadBaselineSnapshot(options.baseline);
    } catch (error) {
      preflightProblems.push(`baseline: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isSupportedNodeVersion(process.versions.node)) {
    preflightProblems.push(`Node ${process.versions.node} is unsupported; package.json requires >=22.13.0`);
  }
  if (worktree !== 'CLEAN') preflightProblems.push('working tree is not clean');
  if (!branch) preflightProblems.push('detached HEAD is not supported');
  if (options.expectBranch && branch !== options.expectBranch) {
    preflightProblems.push(`expected branch ${options.expectBranch}, observed ${branch}`);
  }

  if (preflightProblems.length > 0) {
    const receipt = buildExecutionReceipt({
      head,
      branch,
      worktree,
      steps,
      baseline,
      preflight: { status: 'FAIL', exitCode: 2, problems: preflightProblems },
    });
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, artifacts: {} }, null, 2) + '\n');
    console.log(JSON.stringify({ status: receipt.executionStatus, head, receipt: relativeToRoot(root, receiptPath), problems: preflightProblems }));
    return 2;
  }

  const focusedLog = path.join(outputDir, steps.focusedTests.log);
  const focusedResult = await runLogged(root, process.execPath, focusedTestArgs(), focusedLog);
  const focusedExit = focusedResult.exitCode;
  const focusedCounts = parseTapCounts(readFileSync(focusedLog, 'utf8'));
  steps.focusedTests = {
    status: focusedExit === 0 ? 'PASS' : 'FAIL',
    exitCode: focusedExit,
    ...focusedCounts,
    log: steps.focusedTests.log,
    ...(focusedResult.spawnError ? { spawnError: focusedResult.spawnError } : {}),
  };

  if (focusedExit === 0) {
    const qaLog = path.join(outputDir, steps.canonicalQa.log);
    const qaResult = await runLogged(root, 'npm', ['run', 'check'], qaLog);
    const qaExit = qaResult.exitCode;
    steps.canonicalQa = {
      status: qaExit === 0 ? 'PASS' : 'FAIL',
      exitCode: qaExit,
      log: steps.canonicalQa.log,
      ...(qaResult.spawnError ? { spawnError: qaResult.spawnError } : {}),
    };
  }

  if (steps.canonicalQa.status === 'PASS') {
    const mutationLog = path.join(outputDir, steps.mutation.log);
    const mutationEnv = { ...process.env, PROVIDER_ADAPTER_MUTATION_REPORT: mutationReportPath };
    const stryker = path.join(root, 'node_modules', '.bin', 'stryker');
    const mutationResult = await runLogged(root, stryker, ['run', 'stryker.provider-adapter.config.mjs'], mutationLog, mutationEnv);
    const mutationExit = mutationResult.exitCode;
    const mutationExists = existsSync(mutationReportPath);
    steps.mutation = {
      status: mutationExit === 0 && mutationExists ? 'PASS' : 'FAIL',
      exitCode: mutationExists ? mutationExit : (mutationExit || 1),
      log: steps.mutation.log,
      ...(mutationResult.spawnError ? { spawnError: mutationResult.spawnError } : {}),
      ...(mutationExists ? summarizeMutationReport(JSON.parse(readFileSync(mutationReportPath, 'utf8'))) : {}),
    };

    if (mutationExists && baselineSnapshot) {
      baseline = {
        source: relativeToRoot(root, baselineSnapshot.source),
        delta: compareMutationReports(
          baselineSnapshot.report,
          JSON.parse(readFileSync(mutationReportPath, 'utf8')),
        ),
      };
    }
  }

  const receipt = buildExecutionReceipt({ head, branch, worktree, steps, baseline });
  const artifacts = {
    mutationReport: existsSync(mutationReportPath) ? path.basename(mutationReportPath) : null,
  };
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, artifacts }, null, 2) + '\n');

  const summary = {
    status: receipt.executionStatus,
    head,
    focusedTests: steps.focusedTests.status,
    canonicalQa: steps.canonicalQa.status,
    mutation: steps.mutation.status,
    mutationScore: steps.mutation.mutationScore ?? null,
    receipt: relativeToRoot(root, receiptPath),
  };
  console.log(JSON.stringify(summary));
  return receipt.exitCode;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedAsScript) {
  main()
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(`provider-adapter-readiness: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    });
}
