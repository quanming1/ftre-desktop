const BACKEND_URL = 'http://localhost:9988';

export interface SessionMeta {
    model?: string | null;
}

export interface SessionSummary {
    session_id: string;
    title: string;
    workspace: string;
    source: string;       // user / email / system
    agent_id: string;     // 关联 AGENT.md 定义，空表示普通会话
    meta: SessionMeta;    // 持久化的 model / agentKey
    created_at: number;
    updated_at: number;
}

export async function fetchSessions(workspace?: string | null): Promise<SessionSummary[]> {
    const params = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    const res = await fetch(`${BACKEND_URL}/session/list${params}`);
    const data = await res.json();
    return data.sessions || [];
}

export async function fetchSessionMessages(sessionId: string): Promise<Array<{ type: string; data: Record<string, unknown>; metadata?: Record<string, unknown>; created_at: number }>> {
    const res = await fetch(`${BACKEND_URL}/session/${sessionId}/messages`);
    const data = await res.json();
    return data.events || [];
}

export async function deleteSession(sessionId: string): Promise<boolean> {
    const res = await fetch(`${BACKEND_URL}/session/${sessionId}`, { method: 'DELETE' });
    const data = await res.json();
    return data.status === 'deleted';
}

export async function fetchModels(): Promise<{ models: Array<{ id: string; name: string; provider: string }> }> {
    const res = await fetch(`${BACKEND_URL}/models`);
    return res.json();
}

export async function cancelChat(sessionId: string): Promise<void> {
    await fetch(`${BACKEND_URL}/chat/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
    });
}

/** 发送消息（fire-and-forget，事件通过全局 SSE 推送） */
export async function sendChat(params: {
    message: Array<{ type: string; data: unknown }>;
    sessionId: string | null;
    model: string | null;
    workspace: string | null;
    agentId?: string;
}): Promise<{ session_id: string }> {
    const res = await fetch(`${BACKEND_URL}/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: params.message,
            session_id: params.sessionId,
            model: params.model,
            workspace: params.workspace,
            agent_id: params.agentId || '',
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function fetchUsage(sessionId: string): Promise<number> {
    try {
        const res = await fetch(`${BACKEND_URL}/session/${sessionId}/usage`);
        const data = await res.json();
        return data.context_tokens || 0;
    } catch {
        return 0;
    }
}


// ─── Chat Agent API ─────────────────────────────────────────────

export interface ChatAgent {
    id: string;
    name: string;
    description: string;
    workspace: string;
    color: string;
    is_builtin: boolean;
    tools?: string[];
}

/** 获取当前 workspace 可选的 agent 列表（内置 + 同 workspace 的自定义） */
export async function fetchChatAgents(workspace: string): Promise<ChatAgent[]> {
    try {
        const res = await fetch(`${BACKEND_URL}/chat/agents?workspace=${encodeURIComponent(workspace)}`);
        const data = await res.json();
        return data.agents || [];
    } catch {
        return [];
    }
}


export interface DiffFileEntry {
    file: string;
    before_content: string;
    after_content: string;
    additions: number;
    deletions: number;
}

export interface DiffResponse {
    call_id: string;
    tool_name: string;
    files: DiffFileEntry[];
}

export async function fetchDiff(callId: string): Promise<DiffResponse | null> {
    try {
        const res = await fetch(`${BACKEND_URL}/diff/${encodeURIComponent(callId)}`);
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

/** 通过影子 git hash 对获取单个文件的 diff 内容 */
/** 获取单文件 unified diff 文本（轻量，用于 inline diff 渲染） */
export async function fetchSnapshotFileDiff(
    workspace: string, fromHash: string, toHash: string, file: string,
): Promise<{ file: string; diff: string } | null> {
    try {
        const params = new URLSearchParams({ workspace, from_hash: fromHash, to_hash: toHash, file, format: "unified" });
        const res = await fetch(`${BACKEND_URL}/diff/snapshot?${params}`);
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

/** 获取单文件 before/after 全文内容（用于 Monaco diff editor） */
export async function fetchSnapshotFileContent(
    workspace: string, fromHash: string, toHash: string, file: string,
): Promise<{ file: string; before_content: string; after_content: string } | null> {
    try {
        const params = new URLSearchParams({ workspace, from_hash: fromHash, to_hash: toHash, file });
        const res = await fetch(`${BACKEND_URL}/diff/snapshot?${params}`);
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

/** 通过影子 git 将文件还原到该工具调用执行前的状态 */
export async function revertDiff(callId: string): Promise<{ status: string; files?: string[] } | null> {
    try {
        const res = await fetch(`${BACKEND_URL}/diff/${encodeURIComponent(callId)}/revert`, {
            method: 'POST',
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}


// ─── Task API ────────────────────────────────────────────────────

export interface TaskItem {
    id: string;
    session_id: string;
    type: string;        // 'compaction' | 'memory_update'
    status: string;      // 'pending' | 'running' | 'completed' | 'failed'
    data: Record<string, unknown>;
    created_at: number;
    started_at: number;
    completed_at: number;
}

export interface TaskListResponse {
    tasks: TaskItem[];
    total: number;
    limit: number;
    offset: number;
}

/** 获取任务列表（支持筛选 + 分页） */
export async function fetchTasks(params?: {
    status?: string;
    type?: string;
    session_id?: string;
    limit?: number;
    offset?: number;
}): Promise<TaskListResponse> {
    try {
        const query = new URLSearchParams();
        if (params?.status) query.set('status', params.status);
        if (params?.type) query.set('type', params.type);
        if (params?.session_id) query.set('session_id', params.session_id);
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.offset) query.set('offset', String(params.offset));
        const qs = query.toString();
        const res = await fetch(`${BACKEND_URL}/task/list${qs ? `?${qs}` : ''}`);
        return res.json();
    } catch {
        return { tasks: [], total: 0, limit: 100, offset: 0 };
    }
}

/** 获取单个任务详情 */
export async function fetchTaskDetail(taskId: string): Promise<TaskItem | null> {
    try {
        const res = await fetch(`${BACKEND_URL}/task/${encodeURIComponent(taskId)}`);
        const data = await res.json();
        return data.task || null;
    } catch {
        return null;
    }
}


// ─── Scheduled Task API ──────────────────────────────────────────

/** 创建定时任务 */
export async function createScheduledTask(params: {
    name: string;
    strategy: string;
    cron: string;
    workspace: string;
    config?: Record<string, unknown>;
}): Promise<{ task?: TaskItem; error?: string; detail?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/scheduled-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return res.json();
    } catch {
        return { error: 'network_error' };
    }
}

/** 获取定时任务列表 */
export async function fetchScheduledTasks(params?: {
    workspace?: string;
    strategy?: string;
    limit?: number;
    offset?: number;
}): Promise<TaskListResponse> {
    try {
        const query = new URLSearchParams();
        if (params?.workspace) query.set('workspace', params.workspace);
        if (params?.strategy) query.set('strategy', params.strategy);
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.offset) query.set('offset', String(params.offset));
        const qs = query.toString();
        const res = await fetch(`${BACKEND_URL}/scheduled-task/list${qs ? `?${qs}` : ''}`);
        return res.json();
    } catch {
        return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
}

/** 更新定时任务 */
export async function updateScheduledTask(
    id: string,
    params: { name?: string; cron?: string; config?: Record<string, unknown> },
): Promise<{ task?: TaskItem; error?: string; detail?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/scheduled-task/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        return res.json();
    } catch {
        return { error: 'network_error' };
    }
}

/** 删除定时任务 */
export async function deleteScheduledTask(id: string): Promise<{ deleted?: boolean; error?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/scheduled-task/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
        return res.json();
    } catch {
        return { error: 'network_error' };
    }
}

/** 取消正在执行的定时任务 */
export async function cancelScheduledTask(id: string): Promise<{ cancelled?: boolean; error?: string; detail?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/scheduled-task/${encodeURIComponent(id)}/cancel`, {
            method: 'POST',
        });
        return res.json();
    } catch {
        return { error: 'network_error' };
    }
}

/** 手动触发定时任务 */
export async function triggerScheduledTask(id: string): Promise<{ result_task?: TaskItem; error?: string }> {
    try {
        const res = await fetch(`${BACKEND_URL}/scheduled-task/${encodeURIComponent(id)}/trigger`, {
            method: 'POST',
        });
        return res.json();
    } catch {
        return { error: 'network_error' };
    }
}

/** 获取定时任务执行历史 */
export async function fetchScheduledTaskRuns(
    id: string,
    params?: { limit?: number; offset?: number },
): Promise<{ runs: TaskItem[]; total: number }> {
    try {
        const query = new URLSearchParams();
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.offset) query.set('offset', String(params.offset));
        const qs = query.toString();
        const res = await fetch(
            `${BACKEND_URL}/scheduled-task/${encodeURIComponent(id)}/runs${qs ? `?${qs}` : ''}`,
        );
        return res.json();
    } catch {
        return { runs: [], total: 0 };
    }
}


// ─── Group Chat API ──────────────────────────────────────────────

export interface AgentDef {
    id: string;
    name: string;
    description: string;
    workspace: string;
    color: string;
    tools: string[];
}

export interface RoomMember {
    agent_id: string;
    agent_name: string;
    session_id: string;
    color: string;
    workspace: string;
    description: string;
}

export interface RoomInfo {
    room_id: string;
    name: string;
    description: string;
    status: string;
    created_at: number;
    updated_at: number;
    members: RoomMember[];
}

export interface RoomMessage {
    id: string;
    sender_id: string;
    sender_name: string;
    color: string;
    content: string;
    type: string;         // 'text' | 'system'
    mentions: string[];
    timestamp: number;
}

/** 获取指定 workspace 下的 agent 定义 */
export async function fetchAgentDefs(workspace: string): Promise<AgentDef[]> {
    try {
        const res = await fetch(`${BACKEND_URL}/group-chat/agents?workspace=${encodeURIComponent(workspace)}`);
        const data = await res.json();
        return data.agents || [];
    } catch {
        return [];
    }
}

/** 创建群聊房间 */
export async function createRoom(name: string, description: string, agentIds: string[]): Promise<RoomInfo | null> {
    try {
        const res = await fetch(`${BACKEND_URL}/group-chat/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, agent_ids: agentIds }),
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

/** 获取所有群聊房间 */
export async function fetchRooms(): Promise<RoomInfo[]> {
    try {
        const res = await fetch(`${BACKEND_URL}/group-chat/rooms`);
        const data = await res.json();
        return data.rooms || [];
    } catch {
        return [];
    }
}

/** 获取群聊消息（支持增量拉取） */
export async function fetchRoomMessages(roomId: string, after: number = 0): Promise<RoomMessage[]> {
    try {
        const params = after > 0 ? `?after=${after}` : '';
        const res = await fetch(`${BACKEND_URL}/group-chat/rooms/${roomId}/messages${params}`);
        const data = await res.json();
        return data.messages || [];
    } catch {
        return [];
    }
}

/** 发送群聊消息（fire-and-forget，agent 在后台异步执行） */
export async function sendRoomMessage(
    roomId: string,
    message: string,
    model?: string | null,
    targetAgentIds?: string[],
): Promise<{ room_id: string; status: string; target_count: number } | null> {
    try {
        const res = await fetch(`${BACKEND_URL}/group-chat/rooms/${roomId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                model: model || null,
                target_agent_ids: targetAgentIds || null,
            }),
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}
