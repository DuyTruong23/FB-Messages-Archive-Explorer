#!/usr/bin/env node
// Builds the Android app under the project build lock:
// web bundle (android mode) → Gradle task → permission gate for APK tasks.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const androidDir = join(root, 'android');
const task = process.argv[2] ?? 'assembleDebug';
const skipWeb = task.startsWith('test');
const outputRoot = readOutputRoot();
let ownsLock = false;

if (outputRoot && !existsSync(parse(outputRoot).root)) fail(`${parse(outputRoot).root} is not mounted. Ask the owner before building.`);

const lockFile = outputRoot ? join(outputRoot, 'gradle.lock') : null;
if (lockFile && existsSync(lockFile)) fail(`Build lock held: ${readFileSync(lockFile, 'utf8').trim()} (${lockFile})`);
if (lockFile) writeFileSync(lockFile, `FB-MAE ${task} ${new Date().toTimeString().slice(0, 5)}\n`);
ownsLock = Boolean(lockFile);

try {
  const env = { ...process.env, ...(outputRoot ? { FBMAE_OUTPUT_ROOT: outputRoot } : {}) };
  if (!skipWeb) run('npm', ['run', 'build:web:android'], root, env);
  const gradlew = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const cacheArgs = outputRoot ? ['--project-cache-dir', join(outputRoot, '.gradle-project')] : [];
  run(gradlew, [task, ...cacheArgs], androidDir, env);
  if (task.startsWith('assemble')) checkPermissions(task === 'assembleRelease' ? 'release' : 'debug');
} finally {
  releaseLock();
}

function releaseLock() {
  if (ownsLock) rmSync(lockFile, { force: true });
  ownsLock = false;
}

function readOutputRoot() {
  const file = join(androidDir, 'local.properties');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find(text => text.startsWith('fbmae.outputRoot='));
  return line ? line.slice('fbmae.outputRoot='.length).replace(/\\:/g, ':').trim() : null;
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function checkPermissions(variant) {
  const buildRoot = outputRoot ? join(outputRoot, 'android-build', 'app') : join(androidDir, 'app', 'build');
  const apkDir = join(buildRoot, 'outputs', 'apk', variant);
  const apk = readdirSync(apkDir).find(name => name.endsWith('.apk'));
  if (!apk) fail(`No APK in ${apkDir}`);
  const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const buildTools = readdirSync(join(sdk, 'build-tools')).sort().at(-1);
  const aapt2 = join(sdk, 'build-tools', buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
  const result = spawnSync(aapt2, ['dump', 'permissions', join(apkDir, apk)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`aapt2 failed: ${result.stderr}`);
  if (result.stdout.includes('android.permission.INTERNET')) fail('The APK requests INTERNET; remove it.');
  console.log(`[build-android] ${apk}: no INTERNET permission`);
}

function fail(message) {
  console.error(`[build-android] ${message}`);
  releaseLock();
  process.exit(1);
}
