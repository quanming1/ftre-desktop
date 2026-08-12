"""commit-msg 校验逻辑（ftre 版，适配多仓库 + master 分支）。

由 .githooks/commit-msg（sh 包装）调用，从提交消息文件第一行解析：
    <type>(<scope>): <subject>

规则（全量对齐 rondo 体系）：
    - type 白名单：feat / fix / prd / todos / docs / refactor / test / style / chore / perf
    - feat / fix / prd / todos：scope 必须是 TODO 阶段标识（A1 / C2 / ZA1 列号风格），
      且必须存在于 docs/TODO.yaml（防写错阶段号）
    - feat / fix 交叉校验：分支名必须关联阶段 id（如 feature/A2-config），
      且 commit scope 必须与分支名中的阶段 id 一致
    - prd / todos：专用分支（prd-update / todos-update）+ 只能修改 docs/ 下文件
    - merge / revert 系统提交跳过

每个仓库的 scope 白名单（非阶段标识的 type 用）在同目录 .scopes 文件中定义，
每行一个 scope，# 开头为注释。.scopes 不存在时放行所有非空 scope。
"""

import re
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
TODO_YAML = REPO_ROOT / "docs" / "TODO.yaml"
SCOPES_FILE = Path(__file__).resolve().parent / ".scopes"

TYPE_WHITELIST = (
    "feat", "fix", "prd", "todos", "docs", "refactor", "test", "style", "chore", "perf",
)
PHASE_RE = re.compile(r"^[A-Z]+[0-9]+$")
PHASE_SCOPED_TYPES = ("feat", "fix", "prd", "todos")
SKIP_PREFIXES = ("merge:", "Merge", "revert:", "Revert")
DOC_BRANCH = {"prd": "prd-update", "todos": "todos-update"}
DOC_ONLY_PREFIX = "docs/"


def load_phase_ids() -> set[str]:
    """从 docs/TODO.yaml 提取全部阶段 id（唯一事实源）。"""
    try:
        data = yaml.safe_load(TODO_YAML.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"无法读取 {TODO_YAML}: {exc}") from exc
    except yaml.YAMLError as exc:
        raise ValueError(f"{TODO_YAML} 解析失败: {exc}") from exc
    try:
        return {step["id"] for stage in data["stages"] for step in stage["steps"]}
    except (KeyError, TypeError) as exc:
        raise ValueError(f"{TODO_YAML} 结构不符合预期（缺少 stages/steps/id）") from exc


def load_module_scopes() -> set[str] | None:
    """从 .scopes 文件加载模块 scope 白名单。返回 None 表示不校验。"""
    if not SCOPES_FILE.is_file():
        return None
    scopes: set[str] = set()
    for line in SCOPES_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            scopes.add(line)
    return scopes or None


def git(args: list[str]) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, encoding="utf-8"
    ).stdout.strip()


def main() -> int:
    if len(sys.argv) < 2:
        print("[错误] 用法: check_commit_msg.py <commit-msg-file>", file=sys.stderr)
        return 1

    msg_file = Path(sys.argv[1])
    if not msg_file.is_file():
        return 0

    first = msg_file.read_text(encoding="utf-8", errors="replace").splitlines()[0]

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
        try:
            phase_ids = load_phase_ids()
        except ValueError as exc:
            print(f"[错误] {exc}", file=sys.stderr)
            print("       修复 docs/TODO.yaml 后再提交", file=sys.stderr)
            return 1
        if scope not in phase_ids:
            print(f"[拒绝] 阶段标识 {scope} 在 docs/TODO.yaml 中不存在", file=sys.stderr)
            print(f"       可用阶段: {' '.join(sorted(phase_ids))}", file=sys.stderr)
            return 1

    # 2b. feat/fix 分支名交叉校验
    if typ in ("feat", "fix"):
        branch = git(["branch", "--show-current"])
        branch_ids = {b.upper() for b in re.findall(r"[A-Za-z]+[0-9]+", branch)}
        if not branch_ids:
            print(
                f"[拒绝] {typ} 分支名必须关联 TODO 阶段 id（如 feature/A2-config）",
                file=sys.stderr,
            )
            print(f"       当前分支: {branch or '(detached)'}（未包含任何阶段 id）", file=sys.stderr)
            return 1
        if scope.upper() not in branch_ids:
            print(
                f"[拒绝] 提交 scope {scope} 与分支名关联的阶段 id 不一致",
                file=sys.stderr,
            )
            print(f"       分支 {branch} 关联的阶段 id: {' / '.join(sorted(branch_ids))}", file=sys.stderr)
            return 1

    # 2c. 非阶段标识的 type：用模块 scope 白名单（如果配置了 .scopes）
    if typ not in PHASE_SCOPED_TYPES:
        module_scopes = load_module_scopes()
        if module_scopes is not None and scope not in module_scopes:
            print(f"[拒绝] scope '{scope}' 不在白名单中", file=sys.stderr)
            print(f"       可用 scope: {' / '.join(sorted(module_scopes))}", file=sys.stderr)
            return 1

    # 3. prd / todos 专用约束：分支 + 文件
    if typ in DOC_BRANCH:
        expect_branch = DOC_BRANCH[typ]
        branch = git(["branch", "--show-current"])
        if branch != expect_branch:
            print(
                f"[拒绝] {typ} 提交必须在 {expect_branch} 分支下进行（当前: {branch or '(detached)'}）",
                file=sys.stderr,
            )
            print(f"       正确流程：git checkout -b {expect_branch}", file=sys.stderr)
            return 1
        files = git(["diff", "--cached", "--name-only"]).splitlines()
        bad = [f for f in files if f and not f.startswith(DOC_ONLY_PREFIX)]
        if bad:
            print(
                f"[拒绝] {typ} 提交只能修改 docs/ 下的文档，发现非文档文件：{' '.join(bad)}",
                file=sys.stderr,
            )
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
