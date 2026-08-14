"""commit-msg 校验逻辑（Rondo 方法通用模板，复制到项目 .githooks/ 后按需裁剪）。

由 .githooks/commit-msg（sh 包装）调用，从提交消息文件第一行解析：
    <type>(<scope>): <subject>

规则（与 Rondo 方法主文档 §4.3 对应）：
    - type 白名单：feat / fix / prd / todos / docs / refactor / test / style / chore / perf
    - feat / fix / prd / todos：scope 必须是 TODO 阶段标识（A1 / C2 / ZA1 列号风格），
      且必须存在于 docs/TODO.yaml（防写错阶段号）
    - feat：额外强制——暂存必须包含对应阶段 PRD（docs/prd/PRD-<scope>-*.md），
      即行为变更必须同步 PRD 变更记录（无 PRD 文件的基建阶段跳过）
    - perf：scope 必须带 FR 引用（C2-FR6 / C2-FR6,FR8），阶段存在且引用的
      FR 编号真实存在于对应 PRD——perf 表示"优化完善已有描述"
    - feat / fix / perf：分支名必须关联阶段 id，且与 scope 的阶段部分一致
    - prd / todos：额外强制专用分支（prd-update / todos-update）+ 仅限 docs/ 文件
    - merge / revert 系统提交跳过
"""

# ============================================================
# 【裁剪点】项目配置：按你的项目修改以下常量
# ============================================================
# 项目文档根目录（相对仓库根）；TODO 与 PRD 的默认路径
DOCS_DIR = "docs"
# TODO 清单文件（相对 DOCS_DIR）——阶段 id 的唯一事实源
TODO_FILE = "docs/TODO.yaml"
# PRD 目录（相对 DOCS_DIR）
PRD_DIR = "docs/prd"
# 其他 type 允许的模块 scope（按项目模块定制）
MODULE_SCOPES = (
    "chat", "ws", "inspector", "electron", "session", "editor", "explorer", "git", "settings", "shared", "tests", "docs", "release",
)
# prd / todos 专用分支名
PRD_BRANCH = "prd-update"
TODOS_BRANCH = "todos-update"
# 阶段标识超过 Z 时是否启用列号风格（ZA1 / AB2）——建议 True
ALLOW_COLUMN_PHASES = True
# ============================================================
# 以上为全部裁剪点
# ============================================================

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

TYPE_WHITELIST = (
    "feat", "fix", "prd", "todos", "docs", "refactor", "test", "style", "chore", "perf",
)
# 阶段标识：A1 / C2 / ZA1（列号风格，超过 Z 用 AA 前缀）
PHASE_RE = re.compile(r"^[A-Z]+[0-9]+$")
# perf scope：阶段 id + FR 引用（C2-FR6 / C2-FR6,FR8）
PERF_RE = re.compile(r"^([A-Z]+[0-9]+)-FR(\d+(?:,FR\d+)*)$")
# scope 必须是阶段标识的 type（功能与规划类提交，都需可追溯到阶段）
PHASE_SCOPED_TYPES = ("feat", "fix", "prd", "todos")
# 需要分支名-阶段交叉校验的 type
BRANCH_CHECKED_TYPES = ("feat", "fix", "perf")
# 系统提交前缀（跳过校验）
SKIP_PREFIXES = ("merge:", "Merge", "revert:", "Revert")
# prd / todos 专用分支
DOC_BRANCH = {"prd": PRD_BRANCH, "todos": TODOS_BRANCH}
# 仅允许修改 docs/ 下文件
DOC_ONLY_PREFIX = DOCS_DIR + "/"


def load_phase_ids() -> set[str]:
    """从 docs/TODO.yaml 提取全部阶段 id（唯一事实源）。"""
    try:
        import yaml
        data = yaml.safe_load((REPO_ROOT / TODO_FILE).read_text(encoding="utf-8"))
    except ImportError:
        print("[错误] 需要 PyYAML（pip install pyyaml）", file=sys.stderr)
        raise SystemExit(1)
    except OSError as exc:
        raise ValueError(f"无法读取 {TODO_FILE}: {exc}") from exc
    except yaml.YAMLError as exc:
        raise ValueError(f"{TODO_FILE} 解析失败（YAML 语法错误）: {exc}") from exc
    try:
        return {step["id"] for stage in data["stages"] for step in stage["steps"]}
    except (KeyError, TypeError) as exc:
        raise ValueError(f"{TODO_FILE} 结构不符合预期（缺少 stages/steps/id）") from exc


def _require_phase_ids() -> set[str]:
    """加载阶段 id；失败打印错误并退出（hook 不放水，避免阶段 id 失联）。"""
    try:
        return load_phase_ids()
    except ValueError as exc:
        print(f"[错误] {exc}", file=sys.stderr)
        print(f"       修复 {TODO_FILE} 后再提交（不放水，避免阶段 id 失联）", file=sys.stderr)
        raise SystemExit(1) from exc


def git(args: list[str]) -> str:
    """执行 git 命令并返回 stdout（去尾换行）。"""
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, encoding="utf-8"
    ).stdout.strip()


def find_prd_files(phase: str) -> list[Path]:
    """查找阶段对应的 PRD 文件（docs/prd/PRD-<阶段>-*.md）。"""
    return sorted(REPO_ROOT.glob(f"{PRD_DIR}/PRD-{phase}-*.md"))


def staged_files() -> set[str]:
    """当前暂存文件集合（相对仓库根路径）。"""
    return {f for f in git(["diff", "--cached", "--name-only"]).splitlines() if f}


def main() -> int:
    if len(sys.argv) < 2:
        print("[错误] 用法: check_commit_msg.py <commit-msg-file>", file=sys.stderr)
        return 1

    msg_file = Path(sys.argv[1])
    if not msg_file.is_file():
        return 0

    first = msg_file.read_text(encoding="utf-8", errors="replace").splitlines()[0]

    # merge / revert 系统提交跳过
    if first.startswith(SKIP_PREFIXES):
        return 0

    # 1. 基本格式 <type>(<scope>): <subject>，type 白名单
    m = re.match(
        r"^(feat|fix|prd|todos|docs|refactor|test|style|chore|perf)\(([^)]*)\):.*$", first
    )
    if not m:
        print("[拒绝] 提交消息必须符合 <type>(<scope>): <subject> 格式", file=sys.stderr)
        print(f"       type 白名单: {' / '.join(TYPE_WHITELIST)}", file=sys.stderr)
        print("       示例: feat(A2): 添加变量替换", file=sys.stderr)
        return 1

    typ, scope = m.group(1), m.group(2)

    # 2. 需要阶段标识的 type：feat/fix/prd/todos
    if typ in PHASE_SCOPED_TYPES:
        if not PHASE_RE.fullmatch(scope):
            print(
                f"[拒绝] {typ} 的 scope 必须是 TODO 阶段标识（A1 / C2 / ZA1 列号风格）",
                file=sys.stderr,
            )
            print(f"       示例: {typ}(A2): 描述", file=sys.stderr)
            return 1
        phase_ids = _require_phase_ids()
        if scope not in phase_ids:
            print(f"[拒绝] 阶段标识 {scope} 在 {TODO_FILE} 中不存在", file=sys.stderr)
            print(f"       可用阶段: {' '.join(sorted(phase_ids))}", file=sys.stderr)
            return 1

    # 3. perf：FR 引用格式 + 阶段存在 + FR 真实存在于 PRD
    perf_phase = None
    if typ == "perf":
        pm = PERF_RE.match(scope)
        if not pm:
            print(
                "[拒绝] perf 的 scope 必须带 FR 引用（如 perf(C2-FR6) / perf(C2-FR6,FR8)）",
                file=sys.stderr,
            )
            print("       perf = 优化完善已有描述（见 docs/COMMIT.md）", file=sys.stderr)
            return 1
        perf_phase, fr_part = pm.group(1), pm.group(2)
        if perf_phase not in _require_phase_ids():
            print(f"[拒绝] perf 引用的阶段 {perf_phase} 在 {TODO_FILE} 中不存在", file=sys.stderr)
            return 1
        prd_files = find_prd_files(perf_phase)
        if not prd_files:
            print(f"[拒绝] 阶段 {perf_phase} 没有 PRD 文件，无法引用 FR", file=sys.stderr)
            return 1
        wanted = {f"FR{n}" for n in re.findall(r"\d+", fr_part)}
        existing = set(re.findall(r"FR\d+", prd_files[0].read_text(encoding="utf-8")))
        missing = wanted - existing
        if missing:
            print(
                f"[拒绝] perf 引用的 FR 不存在于 {prd_files[0].name}: {' '.join(sorted(missing))}",
                file=sys.stderr,
            )
            return 1

    # 4. feat：必须同步 PRD 变更记录（暂存含对应阶段 PRD 文件；无 PRD 的基建阶段跳过）
    if typ == "feat":
        prd_files = find_prd_files(scope)
        if prd_files:
            rel = {p.relative_to(REPO_ROOT).as_posix() for p in prd_files}
            if not (staged_files() & rel):
                print(
                    f"[拒绝] feat 提交必须同步 PRD 变更记录：暂存缺少 {prd_files[0].name}",
                    file=sys.stderr,
                )
                print("       行为变更需在对应 PRD 的「变更记录」追加说明后再提交", file=sys.stderr)
                return 1

    # 5. 分支名-阶段交叉校验：feat/fix/perf（scope 的阶段部分与分支名一致）
    if typ in BRANCH_CHECKED_TYPES:
        branch = git(["branch", "--show-current"])
        branch_scope = perf_phase if typ == "perf" else scope
        branch_ids = {b.upper() for b in re.findall(r"[A-Za-z]+[0-9]+", branch)}
        if not branch_ids:
            print(
                f"[拒绝] {typ} 分支名必须关联 TODO 阶段 id（如 feature/A2-config、feature/fix-c1-checkpoint）",
                file=sys.stderr,
            )
            print(f"       当前分支: {branch or '(detached)'}（未包含任何阶段 id）", file=sys.stderr)
            return 1
        if branch_scope.upper() not in branch_ids:
            print(
                f"[拒绝] 提交 scope {scope} 与分支名关联的阶段 id 不一致",
                file=sys.stderr,
            )
            print(f"       分支 {branch} 关联的阶段 id: {' / '.join(sorted(branch_ids))}", file=sys.stderr)
            print("       请在正确分支提交，或改分支名使阶段 id 一致", file=sys.stderr)
            return 1

    # 5b. 非阶段标识的 type：模块 scope 白名单
    if typ not in PHASE_SCOPED_TYPES and typ != "perf":
        if scope not in MODULE_SCOPES:
            print(f"[拒绝] scope '{scope}' 不在白名单中", file=sys.stderr)
            print(f"       可用 scope: {' / '.join(sorted(MODULE_SCOPES))}", file=sys.stderr)
            return 1

    # 6. prd / todos 专用约束：分支 + 文件
    if typ in DOC_BRANCH:
        expect_branch = DOC_BRANCH[typ]
        branch = git(["branch", "--show-current"])
        if branch != expect_branch:
            print(
                f"[拒绝] {typ} 提交必须在 {expect_branch} 分支下进行（当前分支: {branch or '(detached)'}）",
                file=sys.stderr,
            )
            print(f"       正确流程：git checkout -b {expect_branch}（从 develop 切出）", file=sys.stderr)
            return 1
        bad = [f for f in staged_files() if not f.startswith(DOC_ONLY_PREFIX)]
        if bad:
            print(
                f"[拒绝] {typ} 提交只能修改 {DOCS_DIR}/ 下的文档，发现非文档文件：{' '.join(bad)}",
                file=sys.stderr,
            )
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
