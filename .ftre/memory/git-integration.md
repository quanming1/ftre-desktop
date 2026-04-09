# Git 集成

> 前端 Git 功能完整链路：UI → Service → IPC → 命令执行

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/git/GitPanel.tsx` | Git 面板 UI，展示变更文件列表，支持 stage/unstage |
| `packages/renderer/src/services/git-service.ts` | 前端 Git 操作单例，统一封装 git API 调用，带缓存机制 |
| `packages/electron/src/ipc/git.ts` | 主进程 IPC 处理器，执行实际 git 命令 |

## 数据流

### 读取 Git 状态
GitPanel → gitService.getStatus() → IPC `git:status` → git.ts:gitExec() → 返回 GitFile[]

### Stage/Unstage 操作
GitPanel → gitService.stage()/unstage() → IPC `git:stage`/`git:unstage` → git.ts:gitExec(['add', ...])

### Commit 操作
GitPanel → gitService.commit(message) → IPC `git:commit` → git.ts:gitExec(['commit', '-m', message])

## 关键数据结构

```typescript
// GitFile 文件状态
{
  path: string,          // 相对路径
  absolutePath: string,  // 绝对路径
  status: "modified" | "untracked" | "deleted" | "added" | "renamed" | "conflict",
  staged: boolean,       // 是否已暂存
  isDir: boolean
}

// GitInfo 仓库信息
{
  branch: string | null,
  changedFiles: number,
  isGitRepo: boolean
}
```

## 注意事项

- gitService 使用指纹机制防止重复请求
- 基于文件系统变更自动刷新缓存
- GitPanel 使用 useGitService hook 订阅状态变更
- 主进程通过 execFile 执行 git 命令，最大缓冲区 10MB
