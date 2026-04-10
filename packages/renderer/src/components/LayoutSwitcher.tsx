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
          h-full px-3 flex items-center justify-center select-none
          transition-all duration-100 ease-out
          ${isDragging
            ? 'z-10 scale-105 shadow-lg shadow-black/40'
            : isDragActive
              ? 'cursor-grab'
              : 'cursor-pointer'
          }
          ${visible
            ? 'text-t-primary bg-white/[0.06]'
            : 'text-t-dim hover:bg-white/[0.06] hover:text-t-muted'
          }
        `}
      >
        <Icon size={14} strokeWidth={1.5} />
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
      <div className="flex items-center h-full">
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
