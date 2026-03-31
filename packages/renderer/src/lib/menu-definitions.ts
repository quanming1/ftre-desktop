import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useLayout } from "@/stores/layout";

export interface MenuItem {
    label: string;
    shortcut?: string;
    action: () => void;
    enabled?: () => boolean;
}

export interface ConfirmAction {
    title: string;
    message: string;
    onConfirm: () => void;
}

function dispatch(eventName: string) {
    window.dispatchEvent(new CustomEvent(eventName));
}

/**
 * Build the full menu definitions. Accepts a callback to trigger a confirm dialog
 * (owned by the TitleBar component) for actions that need user confirmation.
 */
export function buildMenuDefinitions(
    setConfirmAction: (action: ConfirmAction | null) => void,
): Record<string, MenuItem[]> {
    return {
        文件: [
            { label: "新建文件", action: () => dispatch("ftre:new-file-global") },
            {
                label: "打开文件夹",
                action: async () => {
                    if (useEditor.getState().hasUnsavedChanges()) {
                        setConfirmAction({
                            title: "未保存的更改",
                            message: "有未保存的更改。打开新文件夹将丢弃这些更改。继续吗？",
                            onConfirm: async () => {
                                setConfirmAction(null);
                                const result = await window.desktop.fs.selectFolder();
                                if (result.path) {
                                    useWorkspace.getState().setRootPath(result.path);
                                }
                            },
                        });
                        return;
                    }
                    const result = await window.desktop.fs.selectFolder();
                    if (result.path) {
                        useWorkspace.getState().setRootPath(result.path);
                    }
                },
            },
            { label: "保存", shortcut: "Ctrl+S", action: () => dispatch("ftre:save-active") },
            { label: "全部保存", action: () => dispatch("ftre:save-all") },
        ],
        编辑: [
            { label: "撤销", shortcut: "Ctrl+Z", action: () => dispatch("ftre:undo") },
            { label: "重做", shortcut: "Ctrl+Y", action: () => dispatch("ftre:redo") },
            { label: "查找", shortcut: "Ctrl+F", action: () => dispatch("ftre:find-in-editor") },
            { label: "替换", shortcut: "Ctrl+H", action: () => dispatch("ftre:replace-in-editor") },
        ],
        视图: [
            {
                label: "切换终端",
                shortcut: "Ctrl+`",
                action: () => {
                    useLayout.getState().toggleTerminalDropdown();
                },
            },
            {
                label: "切换侧边栏",
                shortcut: "Ctrl+B",
                action: () => useLayout.getState().toggleSidebar(),
            },
            {
                label: "命令面板",
                shortcut: "Ctrl+Shift+P",
                action: () => dispatch("ftre:toggle-command-palette"),
            },
        ],
    };
}

/** Menu labels that appear in the title bar but have no dropdown (placeholder) */
export const menusWithoutDropdown = ["运行", "工具", "AI"];
