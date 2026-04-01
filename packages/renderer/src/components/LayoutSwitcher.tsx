import { useState, useRef, useEffect } from 'react';
import { FolderTree, Code2, MessageSquare, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import type { PanelId } from '@/stores/layout';

interface LayoutSwitcherProps {
  open: boolean;
  onClose: () => void;
  panelOrder: PanelId[];
  onChange: (order: PanelId[]) => void;
}

const PANEL_INFO: Record<PanelId, { label: string; icon: React.ReactNode }> = {
  sidebar: { label: '文件树', icon: <FolderTree size={16} strokeWidth={1.5} /> },
  editor: { label: '编辑器', icon: <Code2 size={16} strokeWidth={1.5} /> },
  chat: { label: 'Chat', icon: <MessageSquare size={16} strokeWidth={1.5} /> },
};

interface SortableCardProps {
  id: PanelId;
}

function SortableCard({ id }: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const info = PANEL_INFO[id];

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      layout
      className={`
        flex-1 flex flex-col items-center gap-1.5 p-3 rounded-md border cursor-grab
        transition-colors select-none
        ${isDragging 
          ? 'border-accent bg-accent/10 shadow-lg z-10 opacity-90' 
          : 'border-border hover:border-border-subtle hover:bg-white/[0.03]'
        }
      `}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="text-t-muted">{info.icon}</div>
      <span className="text-[11px] text-t-secondary">{info.label}</span>
      <GripVertical size={12} className="text-t-ghost mt-0.5" />
    </motion.div>
  );
}

export function LayoutSwitcher({ open, onClose, panelOrder, onChange }: LayoutSwitcherProps) {
  const [localOrder, setLocalOrder] = useState<PanelId[]>(panelOrder);
  const popoverRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sync local state when prop changes
  useEffect(() => {
    setLocalOrder(panelOrder);
  }, [panelOrder]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localOrder.indexOf(active.id as PanelId);
      const newIndex = localOrder.indexOf(over.id as PanelId);
      const newOrder = arrayMove(localOrder, oldIndex, newIndex);
      setLocalOrder(newOrder);
      onChange(newOrder);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="absolute top-full right-0 mt-1 bg-elevated border border-border-subtle rounded-lg shadow-2xl z-[60] overflow-hidden"
          style={{ minWidth: 280 }}
        >
          <div className="px-3 py-2 border-b border-border-subtle">
            <span className="text-[12px] text-t-secondary font-medium">调整面板布局</span>
          </div>
          <div className="p-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={localOrder} strategy={horizontalListSortingStrategy}>
                <div className="flex gap-2">
                  {localOrder.map((id) => (
                    <SortableCard key={id} id={id} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
          <div className="px-3 py-2 border-t border-border-subtle">
            <span className="text-[11px] text-t-ghost">拖拽卡片调整顺序</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
