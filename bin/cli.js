#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkCommand } = require('../lib');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'claude-sec-hooks.json');
const SUPPORTED_LANGS = ['en', 'vi'];

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function runLang() {
  const requested = process.argv[3]?.trim().toLowerCase();
  const config = readConfig();

  if (!requested) {
    console.log(`Current language: ${config.lang || 'en'} (default)`);
    console.log(`Usage: claude-sec-hooks lang <${SUPPORTED_LANGS.join('|')}>`);
    return;
  }

  if (!SUPPORTED_LANGS.includes(requested)) {
    console.error(`Unsupported language: ${requested}`);
    console.error(`Supported languages: ${SUPPORTED_LANGS.join(', ')}`);
    process.exit(1);
  }

  config.lang = requested;
  writeConfig(config);
  console.log(`Language set to '${requested}'. Saved to ${CONFIG_PATH}`);
}

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
  const lang = readConfig().lang || process.env.CLAUDE_HOOK_LANG;
  const output = checkCommand(cmd, { lang });
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
  if (sub === 'lang') {
    runLang();
    return;
  }
  if (sub === 'hook' || !sub) {
    await runHook();
    return;
  }
  console.error(`Unknown command: ${sub}`);
  console.error(`Usage: claude-sec-hooks <hook|install|lang> [--project|<${SUPPORTED_LANGS.join('|')}>]`);
  process.exit(1);
}

main();
