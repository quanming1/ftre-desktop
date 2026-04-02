import { useState, useCallback } from 'react';
import { FolderTree, Code2, MessageSquare, MessagesSquare } from 'lucide-react';
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
import type { PanelId } from '@/stores/layout';

interface LayoutSwitcherProps {
  panelOrder: PanelId[];
  panelVisible: Record<PanelId, boolean>;
  onOrderChange: (order: PanelId[]) => void;
  onToggleVisible: (panel: PanelId) => void;
}

const PANEL_INFO: Record<PanelId, { label: string; icon: React.ReactNode }> = {
  sessions: { label: 'Sessions', icon: <MessagesSquare size={14} strokeWidth={1.5} /> },
  sidebar: { label: 'Explorer', icon: <FolderTree size={14} strokeWidth={1.5} /> },
  editor: { label: 'Editor', icon: <Code2 size={14} strokeWidth={1.5} /> },
  chat: { label: 'Chat', icon: <MessageSquare size={14} strokeWidth={1.5} /> },
};

interface SortableItemProps {
  id: PanelId;
  visible: boolean;
  onToggle: () => void;
}

function SortableItem({ id, visible, onToggle }: SortableItemProps) {
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

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!isDragging) {
      onToggle();
    }
  }, [isDragging, onToggle]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded cursor-grab select-none
        transition-colors duration-100
        ${isDragging ? 'opacity-50' : ''}
        ${visible
          ? 'text-t-primary bg-white/[0.08]'
          : 'text-t-ghost hover:text-t-muted hover:bg-white/[0.04]'
        }
      `}
      title={`${info.label} - Click to ${visible ? 'hide' : 'show'}, drag to reorder`}
    >
      {info.icon}
      <span className="text-[11px] font-mono">{info.label}</span>
    </div>
  );
}

export function LayoutSwitcher({ panelOrder, panelVisible, onOrderChange, onToggleVisible }: LayoutSwitcherProps) {
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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = panelOrder.indexOf(active.id as PanelId);
      const newIndex = panelOrder.indexOf(over.id as PanelId);
      const newOrder = arrayMove(panelOrder, oldIndex, newIndex);
      onOrderChange(newOrder);
    }
  }, [panelOrder, onOrderChange]);

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-md border border-border bg-base">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={panelOrder} strategy={horizontalListSortingStrategy}>
          {panelOrder.map((id) => (
            <SortableItem
              key={id}
              id={id}
              visible={panelVisible[id]}
              onToggle={() => onToggleVisible(id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
