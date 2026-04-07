import { CommandPalette as BaseCommandPalette, type CommandItem } from "@ftre/ui";
import { useShortcut, type ShortcutBinding } from "@/stores/shortcut";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutCommandItem extends CommandItem {
  execute: () => void;
}

function shortcutToCommand(binding: ShortcutBinding): ShortcutCommandItem {
  return {
    id: binding.id,
    label: binding.label,
    category: binding.category,
    shortcut: binding.keys,
    execute: binding.execute,
  };
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const bindings = useShortcut((s) => s.bindings);
  const items = bindings.map(shortcutToCommand);

  return (
    <BaseCommandPalette
      open={open}
      onClose={onClose}
      items={items}
      onSelect={(item) => item.execute()}
      placeholder="输入命令..."
      emptyMessage="未找到命令"
    />
  );
}
