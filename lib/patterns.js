'use strict';

const COLOR = { CRITICAL: '🟥', HIGH: '🟧', MEDIUM: '🟨', LOW: '🟩' };
const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// Explanations default to English. Set CLAUDE_HOOK_LANG=vi to get Vietnamese
// explanations instead — severity tags (CRITICAL/HIGH/MEDIUM/LOW) stay in
// English either way since they're the compact, scannable part.
const VI_TRANSLATIONS = {
  // classify_rm / classify_chmod
  'Recursively force-deletes a root/home-level directory — catastrophic, irreversible':
    'Xóa đệ quy một thư mục gốc/home — thảm họa, không thể khôi phục',
  'Deletes files/directories recursively with root privileges — irreversible, no permission boundary left to stop it':
    'Xóa file/thư mục đệ quy với quyền root — không thể khôi phục, không còn rào cản quyền hạn nào để ngăn lại',
  'Recursively force-deletes files/directories — irreversible for the given path':
    'Xóa đệ quy file/thư mục — không thể khôi phục cho đường dẫn này',
  'Recursively grants read/write/execute to everyone — security risk, hard to fully undo':
    'Cấp quyền đọc/ghi/thực thi đệ quy cho tất cả mọi người — rủi ro bảo mật, khó hoàn tác triệt để',
  'Grants read/write/execute to everyone — security risk, hard to fully undo':
    'Cấp quyền đọc/ghi/thực thi cho tất cả mọi người — rủi ro bảo mật, khó hoàn tác triệt để',

  // CRITICAL
  'Writes raw data directly to a block device — can destroy an entire disk/partition':
    'Ghi dữ liệu thô trực tiếp vào block device — có thể phá hủy toàn bộ ổ đĩa/phân vùng',
  'Formats a filesystem — destroys all data on the target device':
    'Format filesystem — xóa sạch toàn bộ dữ liệu trên thiết bị đích',
  'Modifies disk partition tables — can destroy data or make a disk unbootable':
    'Thay đổi bảng phân vùng ổ đĩa — có thể phá hủy dữ liệu hoặc khiến ổ đĩa không thể boot',
  'Erases or repartitions a disk/volume — irreversible, total data loss':
    'Xóa hoặc phân vùng lại ổ đĩa/volume — không thể khôi phục, mất toàn bộ dữ liệu',
  'Redirects output directly onto a raw disk device — can destroy data':
    'Ghi output trực tiếp lên raw disk device — có thể phá hủy dữ liệu',
  'Pipes command output directly into a shell/interpreter — runs whatever that output is as code, without review':
    'Pipe output trực tiếp vào shell/interpreter — chạy bất cứ thứ gì trong output đó như code, không qua kiểm tra',
  'Permanently deletes a database/table/schema and all its data':
    'Xóa vĩnh viễn database/table/schema và toàn bộ dữ liệu bên trong',
  'Irreversibly deletes all rows in a table':
    'Xóa không thể khôi phục toàn bộ hàng trong một table',
  'Deletes rows with no WHERE clause — likely wipes the entire table':
    'Xóa hàng mà không có mệnh đề WHERE — nhiều khả năng xóa sạch toàn bộ table',
  'Force-kills every process on the machine — will crash the session/OS':
    'Force-kill toàn bộ process trên máy — sẽ làm crash session/hệ điều hành',
  'Creates/captures a real payment against the live Stripe key — moves real money':
    'Tạo/thu tiền thật với live Stripe key — dịch chuyển tiền thật',
  'Runs a Stripe CLI command against the live (production) API key — real money/data impact':
    'Chạy lệnh Stripe CLI với API key live (production) — ảnh hưởng tiền/dữ liệu thật',
  'Deletes an entire GCP project and all its resources — irreversible':
    'Xóa toàn bộ GCP project và mọi resource bên trong — không thể khôi phục',
  'Deletes an entire Azure resource group and everything in it — irreversible':
    'Xóa toàn bộ Azure resource group và mọi thứ bên trong — không thể khôi phục',
  'Wipes the entire Redis cache/store — all keys lost':
    'Xóa sạch toàn bộ Redis cache/store — mất hết key',
  'Drops an entire MongoDB database and all its collections':
    'Drop toàn bộ MongoDB database và mọi collection bên trong',

  // HIGH
  'Force-pushes over the main/master branch — can permanently overwrite shared history':
    'Force-push đè lên branch main/master — có thể ghi đè vĩnh viễn lịch sử dùng chung',
  'Rewrites entire git history — irreversible, breaks other clones/collaborators':
    'Viết lại toàn bộ lịch sử git — không thể khôi phục, làm hỏng clone/collaborator khác',
  'Updates rows with no WHERE clause — likely overwrites the entire table':
    'Update hàng mà không có mệnh đề WHERE — nhiều khả năng ghi đè toàn bộ table',
  'Deletes Kubernetes resources in bulk — can take down a whole environment':
    'Xóa hàng loạt resource Kubernetes — có thể làm sập cả một môi trường',
  'Targets a production Kubernetes context — changes affect a live cluster':
    'Nhắm vào Kubernetes context production — thay đổi ảnh hưởng cluster đang chạy thật',
  'Tears down provisioned infrastructure — can delete real cloud resources irreversibly':
    'Phá hủy hạ tầng đã provision — có thể xóa resource cloud thật không thể khôi phục',
  'Applies infrastructure changes with no confirmation prompt — can modify/replace live resources unattended':
    'Áp dụng thay đổi hạ tầng mà không cần xác nhận — có thể sửa/thay resource đang chạy thật mà không giám sát',
  'Creates or captures a payment/charge — moves real money if not in test mode':
    'Tạo hoặc thu một khoản thanh toán — dịch chuyển tiền thật nếu không ở chế độ test',
  'Tears down a deployed SST stack and its resources — irreversible':
    'Phá hủy SST stack đã deploy cùng resource của nó — không thể khôi phục',
  'Deploys to the production SST stage — affects a live environment':
    'Deploy lên SST stage production — ảnh hưởng môi trường đang chạy thật',
  'Deletes a Vercel project/deployment — irreversible':
    'Xóa project/deployment trên Vercel — không thể khôi phục',
  'Destroys a Fly.io app or machine — irreversible, takes down the running service':
    'Phá hủy app hoặc machine trên Fly.io — không thể khôi phục, làm sập service đang chạy',
  'Deletes a GCP compute instance — irreversible':
    'Xóa một GCP compute instance — không thể khôi phục',
  'Deletes an Azure VM — irreversible':
    'Xóa một Azure VM — không thể khôi phục',
  'Permanently discards unreachable git objects — no more reflog-based recovery':
    'Xóa vĩnh viễn các git object không còn tham chiếu — không thể khôi phục qua reflog nữa',
  'Tears down containers AND deletes their volumes — real data loss':
    'Phá hủy container VÀ xóa luôn volume của chúng — mất dữ liệu thật',
  'Shuts down or reboots the machine — disrupts everything running on it':
    'Tắt hoặc khởi động lại máy — làm gián đoạn mọi thứ đang chạy trên đó',
  'Wipes all scheduled cron jobs with no confirmation and no backup':
    'Xóa sạch mọi cron job đã lên lịch mà không xác nhận, không backup',
  'Flushes or disables firewall rules — opens up network exposure':
    'Xóa hoặc tắt firewall rules — mở toang khả năng lộ mạng',
  "Deletes a user account — irreversible, can lock out access":
    'Xóa một user account — không thể khôi phục, có thể khiến bị khóa quyền truy cập',

  // MEDIUM
  'Recursively changes file ownership — can break permissions across a directory tree':
    'Đổi quyền sở hữu file đệ quy — có thể làm hỏng phân quyền trong cả cây thư mục',
  'Force-pushes and overwrites remote history on the target branch':
    'Force-push và ghi đè lịch sử remote trên branch đích',
  'Discards local commits and uncommitted changes back to a given point':
    'Loại bỏ commit local và thay đổi chưa commit, đưa về một điểm cho trước',
  'Permanently deletes untracked files/directories from the working tree':
    'Xóa vĩnh viễn file/thư mục chưa được track khỏi working tree',
  'Force-deletes a branch even if it has unmerged commits':
    'Force xóa một branch kể cả khi còn commit chưa merge',
  'Discards all uncommitted local changes in the working tree':
    'Loại bỏ toàn bộ thay đổi local chưa commit trong working tree',
  'Deletes a remote branch or tag':
    'Xóa một branch hoặc tag trên remote',
  'Force-kills a process — unsaved state in that process is lost':
    'Force-kill một process — mất trạng thái chưa lưu của process đó',
  "Removes all unused Docker images/containers/volumes — can't be undone":
    'Xóa mọi image/container/volume Docker không dùng đến — không thể hoàn tác',
  'Force-removes all running containers':
    'Force xóa toàn bộ container đang chạy',
  'Deletes a Docker volume — any data stored in it is lost':
    'Xóa một Docker volume — mất mọi dữ liệu lưu trong đó',
  'Deletes a Docker network':
    'Xóa một Docker network',
  'Modifies live Kubernetes cluster state':
    'Thay đổi trạng thái cluster Kubernetes đang chạy thật',
  'Applies infrastructure changes — may create, modify, or replace real cloud resources':
    'Áp dụng thay đổi hạ tầng — có thể tạo, sửa, hoặc thay resource cloud thật',
  'Edits Terraform state directly — can desync state from real infrastructure':
    'Sửa trực tiếp Terraform state — có thể làm state lệch khỏi hạ tầng thật',
  'Stops or disables a system service — can take down a running service':
    'Dừng hoặc tắt một system service — có thể làm sập service đang chạy',
  'Unloads/removes a launchd service — can stop a running background process':
    'Unload/xóa một launchd service — có thể dừng background process đang chạy',
  'Publishes a package publicly to the npm registry — visible to everyone, hard to fully unpublish':
    'Publish package công khai lên npm registry — ai cũng thấy được, khó unpublish triệt để',
  'Publishes a package publicly to the registry — visible to everyone, hard to fully unpublish':
    'Publish package công khai lên registry — ai cũng thấy được, khó unpublish triệt để',
  'Installs packages with root privileges — can affect system-wide Python/Node':
    'Cài package với quyền root — có thể ảnh hưởng Python/Node ở phạm vi toàn hệ thống',
  'Removes packages/files across all workspaces in a monorepo at once':
    'Xóa package/file trên toàn bộ workspace trong monorepo cùng lúc',
  'Interacts with the Stripe API — verify test vs. live mode before proceeding':
    'Tương tác với Stripe API — kiểm tra test hay live mode trước khi tiếp tục',
  'Deploys an SST stack — creates/updates real cloud resources':
    'Deploy một SST stack — tạo/cập nhật resource cloud thật',
  'Deploys to Vercel production — goes live immediately, visible to real users':
    'Deploy lên Vercel production — lên live ngay lập tức, người dùng thật thấy được',
  "Removes a Vercel environment variable — can break the deployed app if it's load-bearing":
    'Xóa một biến môi trường trên Vercel — có thể làm hỏng app đã deploy nếu biến đó quan trọng',
  'Deploys to Fly.io — replaces the running production app/relay instance':
    'Deploy lên Fly.io — thay thế app/relay instance production đang chạy',
  'Changes Fly.io app configuration, secrets, or storage on a live service':
    'Thay đổi cấu hình app, secrets, hoặc storage trên Fly.io của service đang chạy thật',
  "Changes another user's password":
    'Đổi mật khẩu của user khác',
  'Prints a secrets/credentials file to the terminal — contents become visible in this session':
    'In file secrets/credentials ra terminal — nội dung sẽ hiển thị trong session này',
  'Sets a credential inline — visible in shell history and process list':
    'Set credential trực tiếp trên dòng lệnh — hiển thị trong shell history và process list',
  'Clears shell history — often used to hide what commands were run':
    'Xóa shell history — thường dùng để giấu các lệnh đã chạy',

  // LOW
  'Clears and reinstalls node_modules — routine but can take a while':
    'Xóa và cài lại node_modules — thường quy nhưng có thể mất thời gian',
  'Read-only command — no changes made to files or system state':
    'Lệnh chỉ đọc — không thay đổi file hay trạng thái hệ thống',

  // AWS CLI
  'Permanently deletes an entire S3 bucket and all objects in it':
    'Xóa vĩnh viễn toàn bộ S3 bucket và mọi object bên trong',
  'Permanently deletes an RDS database instance':
    'Xóa vĩnh viễn một RDS database instance',
  'Deletes an entire CloudFormation stack and every resource it manages':
    'Xóa toàn bộ CloudFormation stack và mọi resource nó quản lý',
  'Permanently deletes a DynamoDB table and all its data':
    'Xóa vĩnh viễn một DynamoDB table và toàn bộ dữ liệu',
  'Terminates EC2 instances — irreversible, the instance and its storage are destroyed':
    'Terminate EC2 instance — không thể khôi phục, instance và storage của nó bị phá hủy',
  'Bulk-deletes S3 objects — irreversible unless bucket versioning is enabled':
    'Xóa hàng loạt object trên S3 — không thể khôi phục trừ khi bucket bật versioning',
  'Permanently deletes an IAM user/role — can break running workloads or lock out access':
    'Xóa vĩnh viễn IAM user/role — có thể làm hỏng workload đang chạy hoặc khóa quyền truy cập',
  'Schedules deletion of a secret — dependent services lose access to it':
    'Lên lịch xóa một secret — các service phụ thuộc sẽ mất quyền truy cập vào nó',
  'Deletes a Lambda function — irreversible':
    'Xóa một Lambda function — không thể khôi phục',
  'Deletes an SSM parameter — can break anything reading it at runtime':
    'Xóa một SSM parameter — có thể làm hỏng bất cứ thứ gì đọc nó lúc runtime',
  'Stops or reboots EC2 instances — downtime for whatever runs on them':
    'Dừng hoặc khởi động lại EC2 instance — gây downtime cho mọi thứ chạy trên đó',
  'Changes IAM credentials or permissions — can grant/revoke access unexpectedly':
    'Thay đổi IAM credentials hoặc quyền — có thể cấp/thu hồi quyền truy cập ngoài ý muốn',
  'Creates/updates a CloudFormation stack — may create, modify, or replace real cloud resources':
    'Tạo/cập nhật một CloudFormation stack — có thể tạo, sửa, hoặc thay resource cloud thật',
  'Modifies RDS instance settings — may cause a reboot/downtime':
    'Sửa cấu hình RDS instance — có thể gây reboot/downtime',
  'Changes inbound firewall rules on a security group':
    'Thay đổi inbound firewall rules trên một security group',
  'Creates or overwrites an SSM parameter — may hold a secret':
    'Tạo hoặc ghi đè một SSM parameter — có thể chứa secret',
};

// SAFE — obvious read-only commands (no warning, no noise)
const SAFE_PREFIXES = [
  'ls ', 'pwd', 'cat ', 'echo ', 'which ', 'whoami', 'date',
  'printenv', 'env', 'ps ', 'df ', 'du -sh', 'wc ', 'file ',
  'head ', 'tail ', 'grep ', 'find . -name', 'man ',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'node --version', 'node -v', 'python --version', 'python3 --version',
  'npm --version', 'npm list', 'npm ls',
];
const CHAIN_CHARS = /[;&|`$><]/;

// DANGER LIBRARY — [regex, severity, explanation], first match wins.
// Grouped by severity (CRITICAL → HIGH → MEDIUM → LOW) so the most dangerous,
// most specific patterns are always checked before broader lower-severity ones
// that could otherwise shadow them.
const DANGER_PATTERNS = [
  // CRITICAL — catastrophic: total data loss, whole-system impact, real money
  // disk / block device
  [/\bdd\s+.*of=\/dev\//i, 'CRITICAL', 'Writes raw data directly to a block device — can destroy an entire disk/partition'],
  [/\bmkfs(\.\w+)?\b/i, 'CRITICAL', 'Formats a filesystem — destroys all data on the target device'],
  [/\b(fdisk|parted|gdisk)\b/i, 'CRITICAL', 'Modifies disk partition tables — can destroy data or make a disk unbootable'],
  [/\bdiskutil\s+(eraseDisk|eraseVolume|partitionDisk)\b/i, 'CRITICAL', 'Erases or repartitions a disk/volume — irreversible, total data loss'],
  [/>\s*\/dev\/sd[a-z]\b/i, 'CRITICAL', 'Redirects output directly onto a raw disk device — can destroy data'],

  // filesystem: rm -rf (all flag styles + sudo escalation) is handled by
  // classifyRm() in COMPOUND_CHECKS, not a static pattern here — a single
  // regex can't reliably catch combined (-rf), separated (-r -f), and
  // GNU long-form (--recursive --force) flags at once.

  // untrusted code execution — keys on the DESTINATION (piped into a shell
  // interpreter), not the source, so it catches curl/wget/echo/base64 -d/
  // openssl etc. equally; the source doesn't matter, the shell does.
  [/\|\s*(sudo\s+)?(sh|bash|zsh|python[0-9.]*)\b/i, 'CRITICAL', 'Pipes command output directly into a shell/interpreter — runs whatever that output is as code, without review'],

  // database
  [/\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i, 'CRITICAL', 'Permanently deletes a database/table/schema and all its data'],
  [/\bTRUNCATE\s+TABLE\b/i, 'CRITICAL', 'Irreversibly deletes all rows in a table'],
  [/\bDELETE\s+FROM\s+\w+\s*(;|$)/i, 'CRITICAL', 'Deletes rows with no WHERE clause — likely wipes the entire table'],

  // process control
  [/\bkill\s+-9\s+-1\b|\bkillall\s+-9\b/i, 'CRITICAL', 'Force-kills every process on the machine — will crash the session/OS'],

  // payments / billing
  [/\bstripe\s+(charges|refunds|payment_intents)\s+(create|capture)\b.*--live\b/i, 'CRITICAL', 'Creates/captures a real payment against the live Stripe key — moves real money'],
  [/\bstripe\s+.*--live\b/i, 'CRITICAL', 'Runs a Stripe CLI command against the live (production) API key — real money/data impact'],

  // other cloud CLIs (GCP / Azure)
  [/\bgcloud\s+projects\s+delete\b/i, 'CRITICAL', 'Deletes an entire GCP project and all its resources — irreversible'],
  [/\baz\s+group\s+delete\b/i, 'CRITICAL', 'Deletes an entire Azure resource group and everything in it — irreversible'],

  // NoSQL / cache databases
  [/\bredis-cli\b.*\bFLUSH(ALL|DB)\b/i, 'CRITICAL', 'Wipes the entire Redis cache/store — all keys lost'],
  [/\bdb\.dropDatabase\s*\(\s*\)/i, 'CRITICAL', 'Drops an entire MongoDB database and all its collections'],

  // AWS CLI — highest-impact destructive actions
  [/\baws\s+s3api\s+delete-bucket\b/i, 'CRITICAL', 'Permanently deletes an entire S3 bucket and all objects in it'],
  [/\baws\s+rds\s+delete-db-instance\b/i, 'CRITICAL', 'Permanently deletes an RDS database instance'],
  [/\baws\s+cloudformation\s+delete-stack\b/i, 'CRITICAL', 'Deletes an entire CloudFormation stack and every resource it manages'],
  [/\baws\s+dynamodb\s+delete-table\b/i, 'CRITICAL', 'Permanently deletes a DynamoDB table and all its data'],

  // HIGH — irreversible, or affects a live/shared system
  // git
  [/\bgit\s+push\s+.*(--force|--force-with-lease|-f)\b.*\b(main|master)\b|\bgit\s+push\s+.*\b(main|master)\b.*(--force|--force-with-lease|-f)\b/i, 'HIGH', 'Force-pushes over the main/master branch — can permanently overwrite shared history'],
  [/\bgit\s+filter-(branch|repo)\b/i, 'HIGH', 'Rewrites entire git history — irreversible, breaks other clones/collaborators'],

  // database
  [/\bUPDATE\s+\w+\s+SET\b(?!.*\bWHERE\b)/i, 'HIGH', 'Updates rows with no WHERE clause — likely overwrites the entire table'],

  // kubernetes
  [/\bkubectl\s+delete\s+(namespace|deployment|pod)\b.*--all\b|\bkubectl\s+delete\s+namespace\b/i, 'HIGH', 'Deletes Kubernetes resources in bulk — can take down a whole environment'],
  [/\bkubectl\b.*--context[= ]\S*(prod|production)\S*/i, 'HIGH', 'Targets a production Kubernetes context — changes affect a live cluster'],

  // terraform / terragrunt
  [/\bterraform\s+destroy\b|\bterragrunt\s+destroy\b/i, 'HIGH', 'Tears down provisioned infrastructure — can delete real cloud resources irreversibly'],
  [/\bterraform\s+apply\b.*(-auto-approve|--auto-approve)\b|\bterragrunt\s+apply\b.*(-auto-approve|--auto-approve)\b/i, 'HIGH', 'Applies infrastructure changes with no confirmation prompt — can modify/replace live resources unattended'],

  // payments / billing
  [/\bstripe\s+(charges|refunds|payment_intents)\s+(create|capture)\b/i, 'HIGH', 'Creates or captures a payment/charge — moves real money if not in test mode'],

  // deployment platforms
  [/\bsst\s+remove\b/i, 'HIGH', 'Tears down a deployed SST stack and its resources — irreversible'],
  [/\bsst\s+deploy\b.*--stage[= ]\S*(prod|production)\b/i, 'HIGH', 'Deploys to the production SST stage — affects a live environment'],
  [/\bvercel\s+(remove|rm)\b/i, 'HIGH', 'Deletes a Vercel project/deployment — irreversible'],
  [/\b(fly|flyctl)\s+(apps\s+destroy|machines\s+destroy)\b/i, 'HIGH', 'Destroys a Fly.io app or machine — irreversible, takes down the running service'],

  // other cloud CLIs (GCP / Azure)
  [/\bgcloud\s+compute\s+instances\s+delete\b/i, 'HIGH', 'Deletes a GCP compute instance — irreversible'],
  [/\baz\s+vm\s+delete\b/i, 'HIGH', 'Deletes an Azure VM — irreversible'],

  // git
  [/\bgit\s+gc\b.*--prune=now\b/i, 'HIGH', 'Permanently discards unreachable git objects — no more reflog-based recovery'],

  // docker
  [/\bdocker[-\s]compose\s+down\b.*(-v\b|--volumes\b)/i, 'HIGH', 'Tears down containers AND deletes their volumes — real data loss'],

  // system-level
  [/\b(sudo\s+)?(shutdown|reboot|halt)\b|\binit\s+0\b/i, 'HIGH', 'Shuts down or reboots the machine — disrupts everything running on it'],
  [/\bcrontab\s+-r\b/i, 'HIGH', 'Wipes all scheduled cron jobs with no confirmation and no backup'],
  [/\biptables\s+-F\b|\bufw\s+(--force\s+)?(reset|disable)\b/i, 'HIGH', 'Flushes or disables firewall rules — opens up network exposure'],
  [/\b(sudo\s+)?userdel\b/i, 'HIGH', 'Deletes a user account — irreversible, can lock out access'],

  // AWS CLI
  [/\baws\s+ec2\s+terminate-instances\b/i, 'HIGH', 'Terminates EC2 instances — irreversible, the instance and its storage are destroyed'],
  [/\baws\s+s3\s+rm\b.*--recursive\b|\baws\s+s3api\s+delete-objects\b/i, 'HIGH', 'Bulk-deletes S3 objects — irreversible unless bucket versioning is enabled'],
  [/\baws\s+iam\s+delete-(user|role)\b/i, 'HIGH', 'Permanently deletes an IAM user/role — can break running workloads or lock out access'],
  [/\baws\s+secretsmanager\s+delete-secret\b/i, 'HIGH', 'Schedules deletion of a secret — dependent services lose access to it'],
  [/\baws\s+lambda\s+delete-function\b/i, 'HIGH', 'Deletes a Lambda function — irreversible'],
  [/\baws\s+ssm\s+delete-parameter\b/i, 'HIGH', 'Deletes an SSM parameter — can break anything reading it at runtime'],

  // MEDIUM — alters state, usually recoverable
  // filesystem: rm -rf and chmod 777 are handled by classifyRm()/classifyChmod()
  [/\bchown\s+-R\b/i, 'MEDIUM', 'Recursively changes file ownership — can break permissions across a directory tree'],

  // git
  [/\bgit\s+push\s+.*(--force|-f)\b(?!-with-lease)/i, 'MEDIUM', 'Force-pushes and overwrites remote history on the target branch'],
  [/\bgit\s+reset\s+--hard\b/i, 'MEDIUM', 'Discards local commits and uncommitted changes back to a given point'],
  [/\bgit\s+clean\s+-[a-z]*[xd][a-z]*[xdf]*\b|\bgit\s+clean\s+-f/i, 'MEDIUM', 'Permanently deletes untracked files/directories from the working tree'],
  [/\bgit\s+branch\s+-D\b/i, 'MEDIUM', 'Force-deletes a branch even if it has unmerged commits'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.\s*$/i, 'MEDIUM', 'Discards all uncommitted local changes in the working tree'],
  [/\bgit\s+push\s+.*--delete\b/i, 'MEDIUM', 'Deletes a remote branch or tag'],

  // process control
  [/\b(kill\s+-9|pkill|killall)\b/i, 'MEDIUM', 'Force-kills a process — unsaved state in that process is lost'],

  // docker / kubernetes
  [/\bdocker\s+system\s+prune\s+-a[f]?\b/i, 'MEDIUM', "Removes all unused Docker images/containers/volumes — can't be undone"],
  [/\bdocker\s+rm\s+-f\s+\$\(docker\s+ps/i, 'MEDIUM', 'Force-removes all running containers'],
  [/\bdocker\s+volume\s+rm\b/i, 'MEDIUM', 'Deletes a Docker volume — any data stored in it is lost'],
  [/\bdocker\s+network\s+rm\b/i, 'MEDIUM', 'Deletes a Docker network'],
  [/\bkubectl\s+(apply|delete|edit|scale|rollout)\b/i, 'MEDIUM', 'Modifies live Kubernetes cluster state'],

  // terraform / terragrunt
  [/\bterraform\s+apply\b|\bterragrunt\s+apply\b/i, 'MEDIUM', 'Applies infrastructure changes — may create, modify, or replace real cloud resources'],
  [/\bterraform\s+state\s+(rm|mv)\b/i, 'MEDIUM', 'Edits Terraform state directly — can desync state from real infrastructure'],

  // system services
  [/\b(sudo\s+)?systemctl\s+(stop|disable|mask)\b/i, 'MEDIUM', 'Stops or disables a system service — can take down a running service'],
  [/\b(sudo\s+)?launchctl\s+(unload|remove|bootout)\b/i, 'MEDIUM', 'Unloads/removes a launchd service — can stop a running background process'],

  // package managers
  [/\bnpm\s+publish\b/i, 'MEDIUM', 'Publishes a package publicly to the npm registry — visible to everyone, hard to fully unpublish'],
  [/\byarn\s+publish\b/i, 'MEDIUM', 'Publishes a package publicly to the registry — visible to everyone, hard to fully unpublish'],
  [/\bsudo\s+(pip|pip3|npm)\s+install\b/i, 'MEDIUM', 'Installs packages with root privileges — can affect system-wide Python/Node'],
  [/\b(npm|yarn)\s+workspaces?\s+.*\b(rm|remove|clean)\b/i, 'MEDIUM', 'Removes packages/files across all workspaces in a monorepo at once'],

  // payments / billing
  [/\bstripe\b/i, 'MEDIUM', 'Interacts with the Stripe API — verify test vs. live mode before proceeding'],

  // deployment platforms
  [/\bsst\s+deploy\b/i, 'MEDIUM', 'Deploys an SST stack — creates/updates real cloud resources'],
  [/\bvercel\b.*--prod\b/i, 'MEDIUM', 'Deploys to Vercel production — goes live immediately, visible to real users'],
  [/\bvercel\s+env\s+(rm|remove)\b/i, 'MEDIUM', "Removes a Vercel environment variable — can break the deployed app if it's load-bearing"],
  [/\b(fly|flyctl)\s+deploy\b/i, 'MEDIUM', 'Deploys to Fly.io — replaces the running production app/relay instance'],
  [/\b(fly|flyctl)\s+(scale|secrets\s+(set|unset)|volumes\s+destroy)\b/i, 'MEDIUM', 'Changes Fly.io app configuration, secrets, or storage on a live service'],

  // system-level
  [/\b(sudo\s+)?passwd\s+\S+/i, 'MEDIUM', "Changes another user's password"],

  // secrets exposure
  [/\bcat\s+.*(\.env\b|id_rsa\b|credentials\b|\.pem\b)/i, 'MEDIUM', 'Prints a secrets/credentials file to the terminal — contents become visible in this session'],
  [/\bexport\s+\w*(SECRET|_KEY|API_KEY|TOKEN|PASSWORD)\w*=/i, 'MEDIUM', 'Sets a credential inline — visible in shell history and process list'],
  [/\bhistory\s+-c\b|\bunset\s+HISTFILE\b/i, 'MEDIUM', 'Clears shell history — often used to hide what commands were run'],

  // AWS CLI
  [/\baws\s+ec2\s+(stop|reboot)-instances\b/i, 'MEDIUM', 'Stops or reboots EC2 instances — downtime for whatever runs on them'],
  [/\baws\s+iam\s+(create|delete)-access-key\b|\baws\s+iam\s+(attach|detach)-role-policy\b/i, 'MEDIUM', 'Changes IAM credentials or permissions — can grant/revoke access unexpectedly'],
  [/\baws\s+cloudformation\s+(update|create)-stack\b/i, 'MEDIUM', 'Creates/updates a CloudFormation stack — may create, modify, or replace real cloud resources'],
  [/\baws\s+rds\s+modify-db-instance\b/i, 'MEDIUM', 'Modifies RDS instance settings — may cause a reboot/downtime'],
  [/\baws\s+ec2\s+(revoke|authorize)-security-group-ingress\b/i, 'MEDIUM', 'Changes inbound firewall rules on a security group'],
  [/\baws\s+ssm\s+put-parameter\b/i, 'MEDIUM', 'Creates or overwrites an SSM parameter — may hold a secret'],

  // LOW — safe, read-only or trivially reversible
  [/\brm\s+-rf\s+.*\bnode_modules\b.*&&.*\b(npm|yarn|pnpm)\s+(install|i)\b/i, 'LOW', 'Clears and reinstalls node_modules — routine but can take a while'],
];

module.exports = { COLOR, SEVERITY_RANK, VI_TRANSLATIONS, SAFE_PREFIXES, CHAIN_CHARS, DANGER_PATTERNS };
