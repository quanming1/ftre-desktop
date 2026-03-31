import { useEffect, useState } from 'react';
import { ClipboardList, Timer } from 'lucide-react';
import { useLayout } from '@/stores/layout';
import { FloatingWindow } from '@/components/FloatingWindow';
import { TaskPanel } from './TaskPanel';
import { ScheduledTaskPanel } from './ScheduledTaskPanel';
import { useTaskStore } from '@/stores/task';
import { useScheduledTaskStore } from '@/stores/scheduled-task';

type Tab = 'monitor' | 'scheduled';

export function TaskDropdown() {
    const isOpen = useLayout((s) => s.taskPanelOpen);
    const toggle = useLayout((s) => s.toggleTaskPanel);
    const startTaskPolling = useTaskStore((s) => s.startPolling);
    const stopTaskPolling = useTaskStore((s) => s.stopPolling);
    const startScheduledPolling = useScheduledTaskStore((s) => s.startPolling);
    const stopScheduledPolling = useScheduledTaskStore((s) => s.stopPolling);
    const [tab, setTab] = useState<Tab>('monitor');

    useEffect(() => {
        if (!isOpen) { stopTaskPolling(); stopScheduledPolling(); return; }
        if (tab === 'monitor') { startTaskPolling(); stopScheduledPolling(); }
        else { stopTaskPolling(); startScheduledPolling(); }
        return () => { stopTaskPolling(); stopScheduledPolling(); };
    }, [isOpen, tab]);

    const tabBtn = (t: Tab, Icon: typeof ClipboardList, label: string) => (
        <button onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-mono transition-colors ${
                tab === t ? 'text-white/80 bg-white/[0.06]' : 'text-white/30 hover:text-white/50'
            }`}>
            <Icon size={12} />{label}
        </button>
    );

    const title = (
        <span className="flex items-center gap-1">
            {tabBtn('monitor', ClipboardList, 'Monitor')}
            {tabBtn('scheduled', Timer, 'Scheduled')}
        </span>
    );

    return (
        <FloatingWindow
            title={title}
            visible={isOpen}
            onClose={toggle}
            defaultRect={{ x: 140, y: 70, width: 780, height: 460 }}
            minWidth={500}
            minHeight={250}
            zIndex={47}
        >
            {tab === 'monitor' ? <TaskPanel /> : <ScheduledTaskPanel />}
        </FloatingWindow>
    );
}
