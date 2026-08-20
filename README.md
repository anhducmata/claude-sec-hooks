# Claude-Sec-Hooks

A `PreToolUse` hook for [Claude Code](https://claude.com/claude-code) that classifies the
risk of every `Bash` command *before* it runs, and shows a color-coded severity + plain-English
explanation — with the option to actually pause and ask for confirmation on the dangerous ones.

No LLM call involved: classification is done with a local, deterministic pattern library, so
it's instant and doesn't depend on model availability or add latency to every command.

## Why

Claude (and any agent) will usually give you a one-line explanation before running a command,
but that explanation doesn't tell you *how risky* the command actually is. This hook adds that
missing signal — an explicit severity rating — and can gate the worst cases behind an actual
confirmation prompt instead of just a heads-up.

## Severity tiers

| Tier | Emoji | Meaning | Gate |
|---|---|---|---|
| CRITICAL | 🟥 | Catastrophic: total data loss, whole-system impact, real money | Asks for confirmation |
| HIGH | 🟧 | Irreversible, or affects a live/shared system | Asks for confirmation |
| MEDIUM | 🟨 | Alters state, usually recoverable | Runs, warning attached |
| LOW | 🟩 | Safe, read-only or trivially reversible | Runs silently |

## Coverage

The pattern library covers: filesystem (`rm -rf`, `chmod`, `chown`), disk/block devices (`dd`,
`mkfs`, `fdisk`, `diskutil`), git (force-push, `reset --hard`, `filter-branch`, remote delete),
SQL databases (`DROP`/`TRUNCATE`/`DELETE` without `WHERE`), NoSQL (`redis-cli FLUSHALL`, MongoDB
`dropDatabase`), process control (`kill -9`), docker/kubernetes, terraform/terragrunt, other
cloud CLIs (GCP, Azure), system services (`systemctl`, `launchctl`), package managers (`npm
publish`), payments (Stripe live-mode calls), deployment platforms (SST, Vercel, Fly.io),
system-level commands (`shutdown`, `crontab -r`, firewall flush, `userdel`), and secrets
exposure (`cat .env`, inline credential exports, history-clearing).

Compound commands (`step1 && step2 && step3`) are split and each step is classified
independently, so a risky step buried in an otherwise benign-looking chain still gets flagged.

Handles several common evasion techniques: `$IFS` used in place of literal spaces, separated
short flags (`rm -r -f`) and GNU long-form flags (`rm --recursive --force`), and pipe-to-shell
patterns regardless of the source feeding the pipe (not just `curl`/`wget`).

## Install

1. Copy `command-danger-check.py` somewhere stable, e.g. `~/.claude/command-danger-check.py`.
2. Add it to your Claude Code settings (`~/.claude/settings.json` for all projects, or
   `.claude/settings.json` for one project):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/command-danger-check.py",
            "statusMessage": "🛡️  Assessing command risk...",
            "timeout": 25
          }
        ]
      }
    ]
  }
}
```

3. That's it — no dependencies beyond Python 3's standard library.

## Extending

`DANGER_PATTERNS` in the script is a flat list of `(regex, severity, explanation)` tuples,
grouped by severity tier (checked CRITICAL → HIGH → MEDIUM → LOW, so more specific/severe
patterns always win over broader ones). Add a tuple to the relevant tier to cover a new command.

For flag-style-agnostic checks (where combined/separated/long-form flags all need to be
recognized as equivalent, like `rm -rf` vs `rm -r -f` vs `rm --recursive --force`), add a
function to `COMPOUND_CHECKS` instead of a single regex — see `classify_rm()` and
`classify_chmod()` for the pattern to follow.

## Known limitations

- Static pre-exec text analysis can't see inside a wrapped script (`./deploy.sh` that
  internally runs `rm -rf /`) — same blind spot any pre-exec hook has.
- Shell quote-splitting/backslash-splitting tricks (e.g. `'r'm -rf /`, which bash concatenates
  into `rm -rf /` at parse time) currently bypass keyword matching, since the literal source
  text never contains the contiguous keyword. Fixing this would require actual shell-token
  parsing rather than regex matching.

## License

MIT
