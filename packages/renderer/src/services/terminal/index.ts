/**
 * 终端模块导出
 */

export { TerminalSessionManager } from './terminal-manager';
export type { TerminalInstanceInfo, ManagedTerminal } from './terminal-config';

import { TerminalSessionManager } from './terminal-manager';

/** 全局终端管理器单例 */
export const terminalManager = new TerminalSessionManager();
