import { MessageSquare, Bot } from 'lucide-react';
import { Tooltip, TooltipProvider } from '@ftre/ui';
import type { LayoutMode } from '@/stores/layout';

interface LayoutSwitcherProps {
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
}

interface ModeButtonProps {
  mode: LayoutMode;
  active: boolean;
  onClick: () => void;
}

function ModeButton({ mode, active, onClick }: ModeButtonProps) {
  const Icon = mode === 'chat' ? MessageSquare : Bot;
  const label = mode === 'chat' ? 'Chat' : 'Agent';

  return (
    <Tooltip content={`${label} Mode`} side="bottom">
      <button
        onClick={onClick}
        className={`
          h-full px-3 flex items-center gap-1.5 text-[12px] font-mono transition-colors
          ${
            active
              ? 'text-t-primary bg-white/[0.12]'
              : 'text-t-dim hover:bg-white/[0.06] hover:text-t-muted'
          }
        `}
      >
        <Icon size={14} strokeWidth={1.5} />
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

export function LayoutSwitcher({ layoutMode, onLayoutModeChange }: LayoutSwitcherProps) {
  return (
    <TooltipProvider>
      <div className="flex items-center h-full">
        <ModeButton
          mode="chat"
          active={layoutMode === 'chat'}
          onClick={() => onLayoutModeChange('chat')}
        />
        <ModeButton
          mode="agent"
          active={layoutMode === 'agent'}
          onClick={() => onLayoutModeChange('agent')}
        />
      </div>
    </TooltipProvider>
  );
}
