'use strict';

const {
  COLOR,
  SEVERITY_RANK,
  VI_TRANSLATIONS,
  SAFE_PREFIXES,
  CHAIN_CHARS,
  DANGER_PATTERNS,
} = require('./patterns');

function tr(text, lang) {
  if (lang === 'vi') return VI_TRANSLATIONS[text] || text;
  return text;
}

// Neutralize $IFS/${IFS} used in place of a literal space to dodge \s-based
// regexes (e.g. `rm${IFS}-rf${IFS}/` is identical to `rm -rf /` at runtime).
function normalizeIfs(cmd) {
  return cmd.replace(/\$\{IFS\}|\$IFS\b/g, ' ');
}

const SHORT_FLAG = /(?<![\w-])-(?!-)[a-zA-Z]+(?![\w-])/g;

// True if any single-dash flag token (e.g. -rf, -Rv) contains `letter`.
// Deliberately excludes --long-form tokens so "--force" doesn't get counted
// as containing 'r' just because the word "force" does.
function hasShortFlagLetter(cmd, letter) {
  const matches = cmd.match(SHORT_FLAG) || [];
  return matches.some((tok) => tok.toLowerCase().includes(letter));
}

const WIPE_TARGET = /(?<![\w/])(\/{1,}|~|\/\*|\*|\/(?:home|Users|root|etc|var)\/\*)(?=\s|$)/;

// Catches `rm` recursive+force regardless of flag style: combined (-rf),
// separated (-r -f), or GNU long-form (--recursive --force) — a single
// combined-token regex misses the latter two entirely.
function classifyRm(cmd) {
  if (!/\brm\b/i.test(cmd)) return null;
  const recursive = hasShortFlagLetter(cmd, 'r') || /--recursive\b/i.test(cmd);
  const force = hasShortFlagLetter(cmd, 'f') || /--force\b/i.test(cmd);
  if (!(recursive && force)) return null;
  if (WIPE_TARGET.test(cmd)) {
    return ['CRITICAL', 'Recursively force-deletes a root/home-level directory — catastrophic, irreversible'];
  }
  if (/\bsudo\s+rm\b/i.test(cmd)) {
    return ['CRITICAL', 'Deletes files/directories recursively with root privileges — irreversible, no permission boundary left to stop it'];
  }
  return ['MEDIUM', 'Recursively force-deletes files/directories — irreversible for the given path'];
}

// Catches chmod wide-open-permissions regardless of flag style (-R, --recursive).
function classifyChmod(cmd) {
  if (!/\bchmod\b/i.test(cmd)) return null;
  const wideOpen = /\b0*777\b/.test(cmd) || /--mode[= ]0*777\b/i.test(cmd);
  if (!wideOpen) return null;
  const recursive = hasShortFlagLetter(cmd, 'r') || /--recursive\b/i.test(cmd);
  if (recursive) {
    return ['MEDIUM', 'Recursively grants read/write/execute to everyone — security risk, hard to fully undo'];
  }
  return ['MEDIUM', 'Grants read/write/execute to everyone — security risk, hard to fully undo'];
}

const COMPOUND_CHECKS = [classifyRm, classifyChmod];

// Split a compound command on top-level ; && || \n, respecting quotes and
// paren depth.
//
// Deliberately does NOT split on a bare `|` — piping is itself part of what a
// step does (e.g. `curl ... | bash`), and the danger patterns need to see both
// sides of the pipe together to catch that.
//
// Tracks `(`/`)` depth (covers both subshells `( ... )` and command
// substitution `$( ... )`) so an operator INSIDE a nested group is never
// treated as a top-level split point.
function splitSegments(cmd) {
  const segments = [];
  let current = [];
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      current.push(c);
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      current.push(c);
    } else if (!inSingle && !inDouble) {
      if (c === '(') {
        depth += 1;
        current.push(c);
      } else if (c === ')') {
        depth = Math.max(0, depth - 1);
        current.push(c);
      } else if (depth === 0 && (cmd.slice(i, i + 2) === '&&' || cmd.slice(i, i + 2) === '||')) {
        segments.push(current.join(''));
        current = [];
        i += 1; // consume both chars of the operator
      } else if (depth === 0 && (c === ';' || c === '\n')) {
        segments.push(current.join(''));
        current = [];
      } else {
        current.push(c);
      }
    } else {
      current.push(c);
    }
    i += 1;
  }
  segments.push(current.join(''));
  return segments.map((s) => s.trim()).filter(Boolean);
}

// Compound checks (flag-style-agnostic rm/chmod) and danger patterns are
// checked FIRST and always win — a safe-looking prefix (e.g. "git branch",
// "ps") must never shadow a more specific danger rule for the same command
// family (e.g. "git branch -D", "psql ... DROP TABLE").
function classifySegment(cmd) {
  for (const check of COMPOUND_CHECKS) {
    const result = check(cmd);
    if (result) return result;
  }

  for (const [pattern, severity, explanation] of DANGER_PATTERNS) {
    if (pattern.test(cmd)) return [severity, explanation];
  }

  const stripped = cmd.trim();
  const matchesSafe = SAFE_PREFIXES.some(
    (p) => stripped === p.trim() || stripped.startsWith(p)
  );
  if (matchesSafe && !CHAIN_CHARS.test(stripped)) {
    return ['LOW', 'Read-only command — no changes made to files or system state'];
  }

  return null;
}

function truncate(s, n = 60) {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// Runs the full classification pipeline for a raw Bash command string and
// returns the hookSpecificOutput payload, or null if nothing warrants a
// warning (mirrors the Python hook's silent-allow exit(0) path).
function checkCommand(cmd, opts = {}) {
  const lang = (opts.lang || process.env.CLAUDE_HOOK_LANG || 'en').trim().toLowerCase();

  if (!cmd || !cmd.trim()) return null;

  const normalized = normalizeIfs(cmd);
  const segments = splitSegments(normalized);
  const findings = []; // [segment, severity, explanation]
  for (const seg of segments) {
    const result = classifySegment(seg);
    if (result) {
      const [severity, explanation] = result;
      findings.push([seg, severity, tr(explanation, lang)]);
    }
  }

  if (!findings.length || findings.every(([, sev]) => sev === 'LOW')) {
    return null;
  }

  const risky = findings.filter(([, sev]) => sev !== 'LOW');
  const effective = risky.length ? risky : findings;
  const overall = effective.reduce(
    (acc, [, sev]) => (SEVERITY_RANK[sev] > SEVERITY_RANK[acc] ? sev : acc),
    'LOW'
  );
  effective.sort((a, b) => SEVERITY_RANK[b[1]] - SEVERITY_RANK[a[1]]);

  let reason;
  if (segments.length > 1) {
    const steps = effective
      .map(([seg, sev, explanation]) => `${COLOR[sev]} ${sev} ${truncate(seg)} — ${explanation}`)
      .join('\n');
    const header = lang === 'vi'
      ? `Compound lệnh, ${segments.length} bước →`
      : `Compound command, ${segments.length} steps →`;
    reason = `${COLOR[overall]} ${header}\n\n${steps}`;
  } else {
    const [, sev, explanation] = effective[0];
    reason = `${COLOR[sev]} ${sev} ${explanation}`;
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecisionReason: reason,
      permissionDecision: overall === 'HIGH' || overall === 'CRITICAL' ? 'ask' : 'allow',
    },
  };
}

module.exports = {
  checkCommand,
  splitSegments,
  classifySegment,
  classifyRm,
  classifyChmod,
  normalizeIfs,
  truncate,
  tr,
};
