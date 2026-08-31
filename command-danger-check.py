#!/usr/bin/env python3
"""
Command danger hook — classifies every Bash command's severity against a local,
deterministic pattern library (git, filesystem, disk, database, network/untrusted-
code, process, docker/k8s, terraform, system services, package managers, payments,
deployment platforms, secrets) and prints a color-coded explanation before it runs.
No LLM call — instant and reliable.

Severity tiers:
  CRITICAL 🟥  catastrophic: total data loss, whole-system impact, real money
  HIGH     🟧  irreversible, or affects a live/shared system
  MEDIUM   🟨  alters state, usually recoverable
  LOW      🟩  safe, read-only or trivially reversible

Uses colored square emoji rather than raw ANSI escape codes — permissionDecisionReason
is rendered as plain text in Claude Code's permission dialog (same reason
aws-safety-check.py in this same settings.json uses emoji, not ANSI, for its warnings).

Outputs hookSpecificOutput JSON to stdout. HIGH/CRITICAL set permissionDecision to
"ask" so the user is prompted to confirm; everything else is "allow" with a
color-coded reason attached so the risk is still visible.
"""

import json
import os
import re
import sys

COLOR = {"CRITICAL": "🟥", "HIGH": "🟧", "MEDIUM": "🟨", "LOW": "🟩"}

# Explanations default to English. Set CLAUDE_HOOK_LANG=vi (env var) to get
# Vietnamese explanations instead — severity tags (CRITICAL/HIGH/MEDIUM/LOW)
# stay in English either way since they're the compact, scannable part.
LANG = os.environ.get("CLAUDE_HOOK_LANG", "en").strip().lower()

VI_TRANSLATIONS = {
    # classify_rm / classify_chmod
    "Recursively force-deletes a root/home-level directory — catastrophic, irreversible":
        "Xóa đệ quy một thư mục gốc/home — thảm họa, không thể khôi phục",
    "Deletes files/directories recursively with root privileges — irreversible, no permission boundary left to stop it":
        "Xóa file/thư mục đệ quy với quyền root — không thể khôi phục, không còn rào cản quyền hạn nào để ngăn lại",
    "Recursively force-deletes files/directories — irreversible for the given path":
        "Xóa đệ quy file/thư mục — không thể khôi phục cho đường dẫn này",
    "Recursively grants read/write/execute to everyone — security risk, hard to fully undo":
        "Cấp quyền đọc/ghi/thực thi đệ quy cho tất cả mọi người — rủi ro bảo mật, khó hoàn tác triệt để",
    "Grants read/write/execute to everyone — security risk, hard to fully undo":
        "Cấp quyền đọc/ghi/thực thi cho tất cả mọi người — rủi ro bảo mật, khó hoàn tác triệt để",

    # CRITICAL
    "Writes raw data directly to a block device — can destroy an entire disk/partition":
        "Ghi dữ liệu thô trực tiếp vào block device — có thể phá hủy toàn bộ ổ đĩa/phân vùng",
    "Formats a filesystem — destroys all data on the target device":
        "Format filesystem — xóa sạch toàn bộ dữ liệu trên thiết bị đích",
    "Modifies disk partition tables — can destroy data or make a disk unbootable":
        "Thay đổi bảng phân vùng ổ đĩa — có thể phá hủy dữ liệu hoặc khiến ổ đĩa không thể boot",
    "Erases or repartitions a disk/volume — irreversible, total data loss":
        "Xóa hoặc phân vùng lại ổ đĩa/volume — không thể khôi phục, mất toàn bộ dữ liệu",
    "Redirects output directly onto a raw disk device — can destroy data":
        "Ghi output trực tiếp lên raw disk device — có thể phá hủy dữ liệu",
    "Pipes command output directly into a shell/interpreter — runs whatever that output is as code, without review":
        "Pipe output trực tiếp vào shell/interpreter — chạy bất cứ thứ gì trong output đó như code, không qua kiểm tra",
    "Permanently deletes a database/table/schema and all its data":
        "Xóa vĩnh viễn database/table/schema và toàn bộ dữ liệu bên trong",
    "Irreversibly deletes all rows in a table":
        "Xóa không thể khôi phục toàn bộ hàng trong một table",
    "Deletes rows with no WHERE clause — likely wipes the entire table":
        "Xóa hàng mà không có mệnh đề WHERE — nhiều khả năng xóa sạch toàn bộ table",
    "Force-kills every process on the machine — will crash the session/OS":
        "Force-kill toàn bộ process trên máy — sẽ làm crash session/hệ điều hành",
    "Creates/captures a real payment against the live Stripe key — moves real money":
        "Tạo/thu tiền thật với live Stripe key — dịch chuyển tiền thật",
    "Runs a Stripe CLI command against the live (production) API key — real money/data impact":
        "Chạy lệnh Stripe CLI với API key live (production) — ảnh hưởng tiền/dữ liệu thật",
    "Deletes an entire GCP project and all its resources — irreversible":
        "Xóa toàn bộ GCP project và mọi resource bên trong — không thể khôi phục",
    "Deletes an entire Azure resource group and everything in it — irreversible":
        "Xóa toàn bộ Azure resource group và mọi thứ bên trong — không thể khôi phục",
    "Wipes the entire Redis cache/store — all keys lost":
        "Xóa sạch toàn bộ Redis cache/store — mất hết key",
    "Drops an entire MongoDB database and all its collections":
        "Drop toàn bộ MongoDB database và mọi collection bên trong",

    # HIGH
    "Force-pushes over the main/master branch — can permanently overwrite shared history":
        "Force-push đè lên branch main/master — có thể ghi đè vĩnh viễn lịch sử dùng chung",
    "Rewrites entire git history — irreversible, breaks other clones/collaborators":
        "Viết lại toàn bộ lịch sử git — không thể khôi phục, làm hỏng clone/collaborator khác",
    "Updates rows with no WHERE clause — likely overwrites the entire table":
        "Update hàng mà không có mệnh đề WHERE — nhiều khả năng ghi đè toàn bộ table",
    "Deletes Kubernetes resources in bulk — can take down a whole environment":
        "Xóa hàng loạt resource Kubernetes — có thể làm sập cả một môi trường",
    "Targets a production Kubernetes context — changes affect a live cluster":
        "Nhắm vào Kubernetes context production — thay đổi ảnh hưởng cluster đang chạy thật",
    "Tears down provisioned infrastructure — can delete real cloud resources irreversibly":
        "Phá hủy hạ tầng đã provision — có thể xóa resource cloud thật không thể khôi phục",
    "Applies infrastructure changes with no confirmation prompt — can modify/replace live resources unattended":
        "Áp dụng thay đổi hạ tầng mà không cần xác nhận — có thể sửa/thay resource đang chạy thật mà không giám sát",
    "Creates or captures a payment/charge — moves real money if not in test mode":
        "Tạo hoặc thu một khoản thanh toán — dịch chuyển tiền thật nếu không ở chế độ test",
    "Tears down a deployed SST stack and its resources — irreversible":
        "Phá hủy SST stack đã deploy cùng resource của nó — không thể khôi phục",
    "Deploys to the production SST stage — affects a live environment":
        "Deploy lên SST stage production — ảnh hưởng môi trường đang chạy thật",
    "Deletes a Vercel project/deployment — irreversible":
        "Xóa project/deployment trên Vercel — không thể khôi phục",
    "Destroys a Fly.io app or machine — irreversible, takes down the running service":
        "Phá hủy app hoặc machine trên Fly.io — không thể khôi phục, làm sập service đang chạy",
    "Deletes a GCP compute instance — irreversible":
        "Xóa một GCP compute instance — không thể khôi phục",
    "Deletes an Azure VM — irreversible":
        "Xóa một Azure VM — không thể khôi phục",
    "Permanently discards unreachable git objects — no more reflog-based recovery":
        "Xóa vĩnh viễn các git object không còn tham chiếu — không thể khôi phục qua reflog nữa",
    "Tears down containers AND deletes their volumes — real data loss":
        "Phá hủy container VÀ xóa luôn volume của chúng — mất dữ liệu thật",
    "Shuts down or reboots the machine — disrupts everything running on it":
        "Tắt hoặc khởi động lại máy — làm gián đoạn mọi thứ đang chạy trên đó",
    "Wipes all scheduled cron jobs with no confirmation and no backup":
        "Xóa sạch mọi cron job đã lên lịch mà không xác nhận, không backup",
    "Flushes or disables firewall rules — opens up network exposure":
        "Xóa hoặc tắt firewall rules — mở toang khả năng lộ mạng",
    "Deletes a user account — irreversible, can lock out access":
        "Xóa một user account — không thể khôi phục, có thể khiến bị khóa quyền truy cập",

    # MEDIUM
    "Recursively changes file ownership — can break permissions across a directory tree":
        "Đổi quyền sở hữu file đệ quy — có thể làm hỏng phân quyền trong cả cây thư mục",
    "Force-pushes and overwrites remote history on the target branch":
        "Force-push và ghi đè lịch sử remote trên branch đích",
    "Discards local commits and uncommitted changes back to a given point":
        "Loại bỏ commit local và thay đổi chưa commit, đưa về một điểm cho trước",
    "Permanently deletes untracked files/directories from the working tree":
        "Xóa vĩnh viễn file/thư mục chưa được track khỏi working tree",
    "Force-deletes a branch even if it has unmerged commits":
        "Force xóa một branch kể cả khi còn commit chưa merge",
    "Discards all uncommitted local changes in the working tree":
        "Loại bỏ toàn bộ thay đổi local chưa commit trong working tree",
    "Deletes a remote branch or tag":
        "Xóa một branch hoặc tag trên remote",
    "Force-kills a process — unsaved state in that process is lost":
        "Force-kill một process — mất trạng thái chưa lưu của process đó",
    "Removes all unused Docker images/containers/volumes — can't be undone":
        "Xóa mọi image/container/volume Docker không dùng đến — không thể hoàn tác",
    "Force-removes all running containers":
        "Force xóa toàn bộ container đang chạy",
    "Deletes a Docker volume — any data stored in it is lost":
        "Xóa một Docker volume — mất mọi dữ liệu lưu trong đó",
    "Deletes a Docker network":
        "Xóa một Docker network",
    "Modifies live Kubernetes cluster state":
        "Thay đổi trạng thái cluster Kubernetes đang chạy thật",
    "Applies infrastructure changes — may create, modify, or replace real cloud resources":
        "Áp dụng thay đổi hạ tầng — có thể tạo, sửa, hoặc thay resource cloud thật",
    "Edits Terraform state directly — can desync state from real infrastructure":
        "Sửa trực tiếp Terraform state — có thể làm state lệch khỏi hạ tầng thật",
    "Stops or disables a system service — can take down a running service":
        "Dừng hoặc tắt một system service — có thể làm sập service đang chạy",
    "Unloads/removes a launchd service — can stop a running background process":
        "Unload/xóa một launchd service — có thể dừng background process đang chạy",
    "Publishes a package publicly to the npm registry — visible to everyone, hard to fully unpublish":
        "Publish package công khai lên npm registry — ai cũng thấy được, khó unpublish triệt để",
    "Publishes a package publicly to the registry — visible to everyone, hard to fully unpublish":
        "Publish package công khai lên registry — ai cũng thấy được, khó unpublish triệt để",
    "Installs packages with root privileges — can affect system-wide Python/Node":
        "Cài package với quyền root — có thể ảnh hưởng Python/Node ở phạm vi toàn hệ thống",
    "Removes packages/files across all workspaces in a monorepo at once":
        "Xóa package/file trên toàn bộ workspace trong monorepo cùng lúc",
    "Interacts with the Stripe API — verify test vs. live mode before proceeding":
        "Tương tác với Stripe API — kiểm tra test hay live mode trước khi tiếp tục",
    "Deploys an SST stack — creates/updates real cloud resources":
        "Deploy một SST stack — tạo/cập nhật resource cloud thật",
    "Deploys to Vercel production — goes live immediately, visible to real users":
        "Deploy lên Vercel production — lên live ngay lập tức, người dùng thật thấy được",
    "Removes a Vercel environment variable — can break the deployed app if it's load-bearing":
        "Xóa một biến môi trường trên Vercel — có thể làm hỏng app đã deploy nếu biến đó quan trọng",
    "Deploys to Fly.io — replaces the running production app/relay instance":
        "Deploy lên Fly.io — thay thế app/relay instance production đang chạy",
    "Changes Fly.io app configuration, secrets, or storage on a live service":
        "Thay đổi cấu hình app, secrets, hoặc storage trên Fly.io của service đang chạy thật",
    "Changes another user's password":
        "Đổi mật khẩu của user khác",
    "Prints a secrets/credentials file to the terminal — contents become visible in this session":
        "In file secrets/credentials ra terminal — nội dung sẽ hiển thị trong session này",
    "Sets a credential inline — visible in shell history and process list":
        "Set credential trực tiếp trên dòng lệnh — hiển thị trong shell history và process list",
    "Clears shell history — often used to hide what commands were run":
        "Xóa shell history — thường dùng để giấu các lệnh đã chạy",

    # LOW
    "Clears and reinstalls node_modules — routine but can take a while":
        "Xóa và cài lại node_modules — thường quy nhưng có thể mất thời gian",
    "Read-only command — no changes made to files or system state":
        "Lệnh chỉ đọc — không thay đổi file hay trạng thái hệ thống",
}


def tr(text: str) -> str:
    if LANG == "vi":
        return VI_TRANSLATIONS.get(text, text)
    return text


def normalize_ifs(cmd: str) -> str:
    """Neutralize $IFS/${IFS} used in place of a literal space to dodge \\s-based
    regexes (e.g. `rm${IFS}-rf${IFS}/` is identical to `rm -rf /` at runtime)."""
    return re.sub(r"\$\{IFS\}|\$IFS\b", " ", cmd)


_SHORT_FLAG = re.compile(r"(?<![\w-])-(?!-)[a-zA-Z]+(?![\w-])")


def _has_short_flag_letter(cmd: str, letter: str) -> bool:
    """True if any single-dash flag token (e.g. -rf, -Rv) contains `letter`.
    Deliberately excludes --long-form tokens so "--force" doesn't get counted
    as containing 'r' just because the word "force" does."""
    return any(letter in tok.lower() for tok in _SHORT_FLAG.findall(cmd))


_WIPE_TARGET = re.compile(r"(?<![\w/])(/{1,}|~|/\*|\*|/(?:home|Users|root|etc|var)/\*)(?=\s|$)")


def classify_rm(cmd: str):
    """Catches `rm` recursive+force regardless of flag style: combined (-rf),
    separated (-r -f), or GNU long-form (--recursive --force) — a single
    combined-token regex misses the latter two entirely."""
    if not re.search(r"\brm\b", cmd, re.IGNORECASE):
        return None
    recursive = _has_short_flag_letter(cmd, "r") or re.search(r"--recursive\b", cmd, re.IGNORECASE)
    force = _has_short_flag_letter(cmd, "f") or re.search(r"--force\b", cmd, re.IGNORECASE)
    if not (recursive and force):
        return None
    if _WIPE_TARGET.search(cmd):
        return "CRITICAL", "Recursively force-deletes a root/home-level directory — catastrophic, irreversible"
    if re.search(r"\bsudo\s+rm\b", cmd, re.IGNORECASE):
        return "CRITICAL", "Deletes files/directories recursively with root privileges — irreversible, no permission boundary left to stop it"
    return "MEDIUM", "Recursively force-deletes files/directories — irreversible for the given path"


def classify_chmod(cmd: str):
    """Catches chmod wide-open-permissions regardless of flag style (-R, --recursive)."""
    if not re.search(r"\bchmod\b", cmd, re.IGNORECASE):
        return None
    wide_open = re.search(r"\b0*777\b", cmd) or re.search(r"--mode[= ]0*777\b", cmd, re.IGNORECASE)
    if not wide_open:
        return None
    recursive = _has_short_flag_letter(cmd, "r") or re.search(r"--recursive\b", cmd, re.IGNORECASE)
    if recursive:
        return "MEDIUM", "Recursively grants read/write/execute to everyone — security risk, hard to fully undo"
    return "MEDIUM", "Grants read/write/execute to everyone — security risk, hard to fully undo"


COMPOUND_CHECKS = (classify_rm, classify_chmod)

# ──────────────────────────────────────────────
# SAFE — obvious read-only commands (no warning, no noise)
# ──────────────────────────────────────────────
SAFE_PREFIXES = (
    "ls ", "pwd", "cat ", "echo ", "which ", "whoami", "date",
    "printenv", "env", "ps ", "df ", "du -sh", "wc ", "file ",
    "head ", "tail ", "grep ", "find . -name", "man ",
    "git status", "git log", "git diff", "git show", "git branch",
    "node --version", "node -v", "python --version", "python3 --version",
    "npm --version", "npm list", "npm ls",
)
CHAIN_CHARS = re.compile(r"[;&|`$><]")

# ──────────────────────────────────────────────
# DANGER LIBRARY — (regex, severity, explanation), first match wins.
# Grouped by severity (CRITICAL → HIGH → MEDIUM → LOW) so the most dangerous,
# most specific patterns are always checked before broader lower-severity ones
# that could otherwise shadow them.
# ──────────────────────────────────────────────
DANGER_PATTERNS = [
    # ════════════════════════════════════════════
    # CRITICAL — catastrophic: total data loss, whole-system impact, real money
    # ════════════════════════════════════════════
    # disk / block device
    (r"\bdd\s+.*of=/dev/", "CRITICAL", "Writes raw data directly to a block device — can destroy an entire disk/partition"),
    (r"\bmkfs(\.\w+)?\b", "CRITICAL", "Formats a filesystem — destroys all data on the target device"),
    (r"\b(fdisk|parted|gdisk)\b", "CRITICAL", "Modifies disk partition tables — can destroy data or make a disk unbootable"),
    (r"\bdiskutil\s+(eraseDisk|eraseVolume|partitionDisk)\b", "CRITICAL", "Erases or repartitions a disk/volume — irreversible, total data loss"),
    (r">\s*/dev/sd[a-z]\b", "CRITICAL", "Redirects output directly onto a raw disk device — can destroy data"),

    # filesystem: rm -rf (all flag styles + sudo escalation) is handled by
    # classify_rm() in COMPOUND_CHECKS, not a static pattern here — a single
    # regex can't reliably catch combined (-rf), separated (-r -f), and
    # GNU long-form (--recursive --force) flags at once.

    # untrusted code execution — keys on the DESTINATION (piped into a shell
    # interpreter), not the source, so it catches curl/wget/echo/base64 -d/
    # openssl etc. equally; the source doesn't matter, the shell does.
    (r"\|\s*(sudo\s+)?(sh|bash|zsh|python[0-9.]*)\b",
     "CRITICAL", "Pipes command output directly into a shell/interpreter — runs whatever that output is as code, without review"),

    # database
    (r"\bDROP\s+(DATABASE|TABLE|SCHEMA)\b", "CRITICAL", "Permanently deletes a database/table/schema and all its data"),
    (r"\bTRUNCATE\s+TABLE\b", "CRITICAL", "Irreversibly deletes all rows in a table"),
    (r"\bDELETE\s+FROM\s+\w+\s*(;|$)", "CRITICAL", "Deletes rows with no WHERE clause — likely wipes the entire table"),

    # process control
    (r"\bkill\s+-9\s+-1\b|\bkillall\s+-9\b", "CRITICAL", "Force-kills every process on the machine — will crash the session/OS"),

    # payments / billing
    (r"\bstripe\s+(charges|refunds|payment_intents)\s+(create|capture)\b.*--live\b", "CRITICAL", "Creates/captures a real payment against the live Stripe key — moves real money"),
    (r"\bstripe\s+.*--live\b", "CRITICAL", "Runs a Stripe CLI command against the live (production) API key — real money/data impact"),

    # other cloud CLIs (GCP / Azure)
    (r"\bgcloud\s+projects\s+delete\b", "CRITICAL", "Deletes an entire GCP project and all its resources — irreversible"),
    (r"\baz\s+group\s+delete\b", "CRITICAL", "Deletes an entire Azure resource group and everything in it — irreversible"),

    # NoSQL / cache databases
    (r"\bredis-cli\b.*\bFLUSH(ALL|DB)\b", "CRITICAL", "Wipes the entire Redis cache/store — all keys lost"),
    (r"\bdb\.dropDatabase\s*\(\s*\)", "CRITICAL", "Drops an entire MongoDB database and all its collections"),

    # ════════════════════════════════════════════
    # HIGH — irreversible, or affects a live/shared system
    # ════════════════════════════════════════════
    # git
    (r"\bgit\s+push\s+.*(--force|--force-with-lease|-f)\b.*\b(main|master)\b|\bgit\s+push\s+.*\b(main|master)\b.*(--force|--force-with-lease|-f)\b",
     "HIGH", "Force-pushes over the main/master branch — can permanently overwrite shared history"),
    (r"\bgit\s+filter-(branch|repo)\b", "HIGH", "Rewrites entire git history — irreversible, breaks other clones/collaborators"),

    # database
    (r"\bUPDATE\s+\w+\s+SET\b(?!.*\bWHERE\b)", "HIGH", "Updates rows with no WHERE clause — likely overwrites the entire table"),

    # kubernetes
    (r"\bkubectl\s+delete\s+(namespace|deployment|pod)\b.*--all\b|\bkubectl\s+delete\s+namespace\b",
     "HIGH", "Deletes Kubernetes resources in bulk — can take down a whole environment"),
    (r"\bkubectl\b.*--context[= ]\S*(prod|production)\S*", "HIGH", "Targets a production Kubernetes context — changes affect a live cluster"),

    # terraform / terragrunt
    (r"\bterraform\s+destroy\b|\bterragrunt\s+destroy\b", "HIGH", "Tears down provisioned infrastructure — can delete real cloud resources irreversibly"),
    (r"\bterraform\s+apply\b.*(-auto-approve|--auto-approve)\b|\bterragrunt\s+apply\b.*(-auto-approve|--auto-approve)\b",
     "HIGH", "Applies infrastructure changes with no confirmation prompt — can modify/replace live resources unattended"),

    # payments / billing
    (r"\bstripe\s+(charges|refunds|payment_intents)\s+(create|capture)\b", "HIGH", "Creates or captures a payment/charge — moves real money if not in test mode"),

    # deployment platforms
    (r"\bsst\s+remove\b", "HIGH", "Tears down a deployed SST stack and its resources — irreversible"),
    (r"\bsst\s+deploy\b.*--stage[= ]\S*(prod|production)\b", "HIGH", "Deploys to the production SST stage — affects a live environment"),
    (r"\bvercel\s+(remove|rm)\b", "HIGH", "Deletes a Vercel project/deployment — irreversible"),
    (r"\b(fly|flyctl)\s+(apps\s+destroy|machines\s+destroy)\b", "HIGH", "Destroys a Fly.io app or machine — irreversible, takes down the running service"),

    # other cloud CLIs (GCP / Azure)
    (r"\bgcloud\s+compute\s+instances\s+delete\b", "HIGH", "Deletes a GCP compute instance — irreversible"),
    (r"\baz\s+vm\s+delete\b", "HIGH", "Deletes an Azure VM — irreversible"),

    # git
    (r"\bgit\s+gc\b.*--prune=now\b", "HIGH", "Permanently discards unreachable git objects — no more reflog-based recovery"),

    # docker
    (r"\bdocker[-\s]compose\s+down\b.*(-v\b|--volumes\b)", "HIGH", "Tears down containers AND deletes their volumes — real data loss"),

    # system-level
    (r"\b(sudo\s+)?(shutdown|reboot|halt)\b|\binit\s+0\b", "HIGH", "Shuts down or reboots the machine — disrupts everything running on it"),
    (r"\bcrontab\s+-r\b", "HIGH", "Wipes all scheduled cron jobs with no confirmation and no backup"),
    (r"\biptables\s+-F\b|\bufw\s+(--force\s+)?(reset|disable)\b", "HIGH", "Flushes or disables firewall rules — opens up network exposure"),
    (r"\b(sudo\s+)?userdel\b", "HIGH", "Deletes a user account — irreversible, can lock out access"),

    # ════════════════════════════════════════════
    # MEDIUM — alters state, usually recoverable
    # ════════════════════════════════════════════
    # filesystem: rm -rf and chmod 777 are handled by classify_rm()/classify_chmod()
    # in COMPOUND_CHECKS (see CRITICAL section above for why).
    (r"\bchown\s+-R\b", "MEDIUM", "Recursively changes file ownership — can break permissions across a directory tree"),

    # git
    (r"\bgit\s+push\s+.*(--force|-f)\b(?!-with-lease)", "MEDIUM", "Force-pushes and overwrites remote history on the target branch"),
    (r"\bgit\s+reset\s+--hard\b", "MEDIUM", "Discards local commits and uncommitted changes back to a given point"),
    (r"\bgit\s+clean\s+-[a-z]*[xd][a-z]*[xdf]*\b|\bgit\s+clean\s+-f", "MEDIUM", "Permanently deletes untracked files/directories from the working tree"),
    (r"\bgit\s+branch\s+-D\b", "MEDIUM", "Force-deletes a branch even if it has unmerged commits"),
    (r"\bgit\s+(checkout|restore)\s+(--\s+)?\.\s*$", "MEDIUM", "Discards all uncommitted local changes in the working tree"),
    (r"\bgit\s+push\s+.*--delete\b", "MEDIUM", "Deletes a remote branch or tag"),

    # process control
    (r"\b(kill\s+-9|pkill|killall)\b", "MEDIUM", "Force-kills a process — unsaved state in that process is lost"),

    # docker / kubernetes
    (r"\bdocker\s+system\s+prune\s+-a[f]?\b", "MEDIUM", "Removes all unused Docker images/containers/volumes — can't be undone"),
    (r"\bdocker\s+rm\s+-f\s+\$\(docker\s+ps", "MEDIUM", "Force-removes all running containers"),
    (r"\bdocker\s+volume\s+rm\b", "MEDIUM", "Deletes a Docker volume — any data stored in it is lost"),
    (r"\bdocker\s+network\s+rm\b", "MEDIUM", "Deletes a Docker network"),
    (r"\bkubectl\s+(apply|delete|edit|scale|rollout)\b", "MEDIUM", "Modifies live Kubernetes cluster state"),

    # terraform / terragrunt
    (r"\bterraform\s+apply\b|\bterragrunt\s+apply\b", "MEDIUM", "Applies infrastructure changes — may create, modify, or replace real cloud resources"),
    (r"\bterraform\s+state\s+(rm|mv)\b", "MEDIUM", "Edits Terraform state directly — can desync state from real infrastructure"),

    # system services
    (r"\b(sudo\s+)?systemctl\s+(stop|disable|mask)\b", "MEDIUM", "Stops or disables a system service — can take down a running service"),
    (r"\b(sudo\s+)?launchctl\s+(unload|remove|bootout)\b", "MEDIUM", "Unloads/removes a launchd service — can stop a running background process"),

    # package managers
    (r"\bnpm\s+publish\b", "MEDIUM", "Publishes a package publicly to the npm registry — visible to everyone, hard to fully unpublish"),
    (r"\byarn\s+publish\b", "MEDIUM", "Publishes a package publicly to the registry — visible to everyone, hard to fully unpublish"),
    (r"\bsudo\s+(pip|pip3|npm)\s+install\b", "MEDIUM", "Installs packages with root privileges — can affect system-wide Python/Node"),
    (r"\b(npm|yarn)\s+workspaces?\s+.*\b(rm|remove|clean)\b", "MEDIUM", "Removes packages/files across all workspaces in a monorepo at once"),

    # payments / billing
    (r"\bstripe\b", "MEDIUM", "Interacts with the Stripe API — verify test vs. live mode before proceeding"),

    # deployment platforms
    (r"\bsst\s+deploy\b", "MEDIUM", "Deploys an SST stack — creates/updates real cloud resources"),
    (r"\bvercel\b.*--prod\b", "MEDIUM", "Deploys to Vercel production — goes live immediately, visible to real users"),
    (r"\bvercel\s+env\s+(rm|remove)\b", "MEDIUM", "Removes a Vercel environment variable — can break the deployed app if it's load-bearing"),
    (r"\b(fly|flyctl)\s+deploy\b", "MEDIUM", "Deploys to Fly.io — replaces the running production app/relay instance"),
    (r"\b(fly|flyctl)\s+(scale|secrets\s+(set|unset)|volumes\s+destroy)\b", "MEDIUM", "Changes Fly.io app configuration, secrets, or storage on a live service"),

    # system-level
    (r"\b(sudo\s+)?passwd\s+\S+", "MEDIUM", "Changes another user's password"),

    # secrets exposure
    (r"\bcat\s+.*(\.env\b|id_rsa\b|credentials\b|\.pem\b)", "MEDIUM", "Prints a secrets/credentials file to the terminal — contents become visible in this session"),
    (r"\bexport\s+\w*(SECRET|_KEY|API_KEY|TOKEN|PASSWORD)\w*=", "MEDIUM", "Sets a credential inline — visible in shell history and process list"),
    (r"\bhistory\s+-c\b|\bunset\s+HISTFILE\b", "MEDIUM", "Clears shell history — often used to hide what commands were run"),

    # ════════════════════════════════════════════
    # LOW — safe, read-only or trivially reversible
    # ════════════════════════════════════════════
    (r"\brm\s+-rf\s+.*\bnode_modules\b.*&&.*\b(npm|yarn|pnpm)\s+(install|i)\b", "LOW", "Clears and reinstalls node_modules — routine but can take a while"),
]


SEVERITY_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


def split_segments(cmd: str):
    """Split a compound command on top-level ; && || \\n, respecting quotes.

    Deliberately does NOT split on a bare `|` — piping is itself part of what a
    step does (e.g. `curl ... | bash`), and the danger patterns need to see both
    sides of the pipe together to catch that.
    """
    segments = []
    current = []
    in_single = in_double = False
    i, n = 0, len(cmd)
    while i < n:
        c = cmd[i]
        if c == "'" and not in_double:
            in_single = not in_single
            current.append(c)
        elif c == '"' and not in_single:
            in_double = not in_double
            current.append(c)
        elif not in_single and not in_double:
            if cmd[i:i + 2] in ("&&", "||"):
                segments.append("".join(current))
                current = []
                i += 1  # consume both chars of the operator
            elif c in (";", "\n"):
                segments.append("".join(current))
                current = []
            else:
                current.append(c)
        else:
            current.append(c)
        i += 1
    segments.append("".join(current))
    return [s.strip() for s in segments if s.strip()]


def classify_segment(cmd: str):
    # Compound checks (flag-style-agnostic rm/chmod) and danger patterns are
    # checked FIRST and always win — a safe-looking prefix (e.g. "git branch",
    # "ps") must never shadow a more specific danger rule for the same command
    # family (e.g. "git branch -D", "psql ... DROP TABLE").
    for check in COMPOUND_CHECKS:
        result = check(cmd)
        if result is not None:
            return result

    for pattern, severity, explanation in DANGER_PATTERNS:
        if re.search(pattern, cmd, re.IGNORECASE):
            return severity, explanation

    stripped = cmd.strip()
    if any(stripped == p.strip() or stripped.startswith(p) for p in SAFE_PREFIXES):
        if not CHAIN_CHARS.search(stripped):
            return "LOW", "Read-only command — no changes made to files or system state"

    return None


def truncate(s: str, n: int = 60) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def main():
    try:
        data = json.load(sys.stdin)
        cmd = data.get("tool_input", {}).get("command", "")
    except Exception:
        sys.exit(0)

    if not cmd.strip():
        sys.exit(0)

    cmd = normalize_ifs(cmd)
    segments = split_segments(cmd)
    findings = []  # (segment, severity, explanation)
    for seg in segments:
        result = classify_segment(seg)
        if result is not None:
            severity, explanation = result
            findings.append((seg, severity, tr(explanation)))

    # Nothing in the whole chain triggered any rule — stay silent and allow.
    if not findings or all(sev == "LOW" for _, sev, _ in findings):
        sys.exit(0)

    # Only report the steps that actually carry risk (skip plain LOW/read-only steps
    # when the chain also has something worse, to keep the message focused).
    risky = [f for f in findings if f[1] != "LOW"] or findings
    overall = max((sev for _, sev, _ in risky), key=lambda s: SEVERITY_RANK[s])
    risky.sort(key=lambda f: SEVERITY_RANK[f[1]], reverse=True)

    if len(segments) > 1:
        steps = "\n".join(
            f"{COLOR[sev]} {sev} {truncate(seg)} — {explanation}"
            for seg, sev, explanation in risky
        )
        header = (f"Compound lệnh, {len(segments)} bước →" if LANG == "vi"
                  else f"Compound command, {len(segments)} steps →")
        reason = f"{COLOR[overall]} {header}\n\n{steps}"
    else:
        _, sev, explanation = risky[0]
        reason = f"{COLOR[sev]} {sev} {explanation}"

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecisionReason": reason,
            "permissionDecision": "ask" if overall in ("HIGH", "CRITICAL") else "allow",
        }
    }
    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
