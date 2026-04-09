import { useCallback, useState } from 'react';
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
import { Tooltip, TooltipProvider } from '@ftre/ui';
import type { PanelId } from '@/stores/layout';

interface LayoutSwitcherProps {
  panelOrder: PanelId[];
  panelVisible: Record<PanelId, boolean>;
  onOrderChange: (order: PanelId[]) => void;
  onToggleVisible: (panel: PanelId) => void;
}

const PANEL_INFO: Record<PanelId, { label: string; icon: typeof MessagesSquare }> = {
  sessions: { label: 'Sessions', icon: MessagesSquare },
  sidebar: { label: 'Explorer', icon: FolderTree },
  editor: { label: 'Editor', icon: Code2 },
  chat: { label: 'Chat', icon: MessageSquare },
};

interface SortableItemProps {
  id: PanelId;
  visible: boolean;
  onToggle: () => void;
  isDragActive: boolean;
}

function SortableItem({ id, visible, onToggle, isDragActive }: SortableItemProps) {
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
  const Icon = info.icon;

  const handleClick = useCallback(() => {
    if (!isDragging) {
      onToggle();
    }
  }, [isDragging, onToggle]);

  return (
    <Tooltip content={`${visible ? 'Hide' : 'Show'} ${info.label}`} side="bottom">
      <button
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        className={`
          relative flex items-center justify-center w-7 h-7 rounded select-none
          transition-all duration-100 ease-out
          ${isDragging 
            ? 'z-10 scale-110 shadow-lg shadow-black/40' 
            : isDragActive 
              ? 'cursor-grab' 
              : 'cursor-pointer'
          }
          ${visible
            ? isDragging
              ? 'text-neon bg-neon/20'
              : 'text-neon hover:bg-neon/10'
            : isDragging
              ? 'text-t-muted bg-white/10'
              : 'text-t-ghost hover:text-t-muted hover:bg-white/[0.04]'
          }
        `}
      >
        <Icon size={14} strokeWidth={1.5} />
        {/* 激活态底部指示条 */}
        {visible && !isDragging && (
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-2 h-0.5 rounded-full bg-neon/60" />
        )}
      </button>
    </Tooltip>
  );
}

export function LayoutSwitcher({ panelOrder, panelVisible, onOrderChange, onToggleVisible }: LayoutSwitcherProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  
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

  const handleDragStart = useCallback(() => {
    setIsDragActive(true);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setIsDragActive(false);
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = panelOrder.indexOf(active.id as PanelId);
      const newIndex = panelOrder.indexOf(over.id as PanelId);
      const newOrder = arrayMove(panelOrder, oldIndex, newIndex);
      onOrderChange(newOrder);
    }
  }, [panelOrder, onOrderChange]);

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={panelOrder} strategy={horizontalListSortingStrategy}>
            {panelOrder.map((id) => (
              <SortableItem
                key={id}
                id={id}
                visible={panelVisible[id]}
                onToggle={() => onToggleVisible(id)}
                isDragActive={isDragActive}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </TooltipProvider>
  );
}
