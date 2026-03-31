import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminal, extractDirName } from './terminal';

beforeEach(() => {
    useTerminal.setState({
        instances: [],
        activeTerminalId: null,
        nextIndex: 1,
    });
});

describe('terminal store — syncFrom', () => {
    it('syncs instances, activeTerminalId and nextIndex from manager', () => {
        const instances = [
            { id: 'term-1', ptyId: 100, label: 'Terminal 1', createdAt: 1000, exited: false, exitCode: null },
            { id: 'term-2', ptyId: 101, label: 'Terminal 2', createdAt: 1001, exited: false, exitCode: null },
        ];

        useTerminal.getState().syncFrom({
            instances,
            activeTerminalId: 'term-2',
            nextIndex: 3,
        });

        const state = useTerminal.getState();
        expect(state.instances).toEqual(instances);
        expect(state.activeTerminalId).toBe('term-2');
        expect(state.nextIndex).toBe(3);
    });

    it('clears state when syncing empty data', () => {
        // First set some data
        useTerminal.getState().syncFrom({
            instances: [{ id: 'term-1', ptyId: 100, label: 'Terminal 1', createdAt: 1000, exited: false, exitCode: null }],
            activeTerminalId: 'term-1',
            nextIndex: 2,
        });

        // Then clear
        useTerminal.getState().syncFrom({
            instances: [],
            activeTerminalId: null,
            nextIndex: 1,
        });

        const state = useTerminal.getState();
        expect(state.instances).toEqual([]);
        expect(state.activeTerminalId).toBeNull();
        expect(state.nextIndex).toBe(1);
    });

    it('overwrites previous state completely', () => {
        useTerminal.getState().syncFrom({
            instances: [{ id: 'term-1', ptyId: 100, label: 'Terminal 1', createdAt: 1000, exited: false, exitCode: null }],
            activeTerminalId: 'term-1',
            nextIndex: 2,
        });

        const newInstances = [
            { id: 'term-3', ptyId: 200, label: 'My Shell', createdAt: 2000, exited: false, exitCode: null },
        ];

        useTerminal.getState().syncFrom({
            instances: newInstances,
            activeTerminalId: 'term-3',
            nextIndex: 4,
        });

        const state = useTerminal.getState();
        expect(state.instances).toEqual(newInstances);
        expect(state.activeTerminalId).toBe('term-3');
        expect(state.nextIndex).toBe(4);
    });
});


describe('extractDirName', () => {
    it('extracts last segment from Unix path', () => {
        expect(extractDirName('/home/user/project')).toBe('project');
    });

    it('extracts last segment from Windows path', () => {
        expect(extractDirName('C:\\Users\\dev\\my-app')).toBe('my-app');
    });

    it('handles trailing slashes', () => {
        expect(extractDirName('/home/user/project/')).toBe('project');
    });

    it('handles trailing backslashes', () => {
        expect(extractDirName('C:\\Users\\dev\\my-app\\')).toBe('my-app');
    });

    it('handles single directory name', () => {
        expect(extractDirName('project')).toBe('project');
    });

    it('handles root path', () => {
        expect(extractDirName('/')).toBe('/');
    });
});
