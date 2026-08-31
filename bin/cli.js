#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkCommand } = require('../lib');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function runHook() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
  }
  const cmd = payload?.tool_input?.command || '';
  const output = checkCommand(cmd);
  if (output) {
    process.stdout.write(JSON.stringify(output) + '\n');
  }
  process.exit(0);
}

function runInstall() {
  const target = process.argv.includes('--project')
    ? path.join(process.cwd(), '.claude', 'settings.json')
    : path.join(os.homedir(), '.claude', 'settings.json');

  fs.mkdirSync(path.dirname(target), { recursive: true });

  let settings = {};
  if (fs.existsSync(target)) {
    try {
      settings = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (err) {
      console.error(`Could not parse existing ${target}: ${err.message}`);
      process.exit(1);
    }
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  const command = 'npx claude-sec-hooks hook';
  const alreadyWired = settings.hooks.PreToolUse.some((entry) =>
    (entry.hooks || []).some((h) => h.command === command)
  );

  if (alreadyWired) {
    console.log(`Already installed in ${target}`);
    return;
  }

  settings.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command }],
  });

  fs.writeFileSync(target, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Installed PreToolUse:Bash hook in ${target}`);
  console.log('Restart Claude Code (or start a new session) for it to take effect.');
}

async function main() {
  const sub = process.argv[2];
  if (sub === 'install') {
    runInstall();
    return;
  }
  if (sub === 'hook' || !sub) {
    await runHook();
    return;
  }
  console.error(`Unknown command: ${sub}`);
  console.error('Usage: claude-sec-hooks <hook|install> [--project]');
  process.exit(1);
}

main();
