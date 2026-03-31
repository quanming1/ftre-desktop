import { useState, useRef, useEffect } from "react";
import { validateFileName } from "../../lib/file-validation";
import { treeIndent } from "./tree-constants";

interface InlineInputProps {
  initialValue?: string;
  placeholder?: string;
  depth: number;
  siblingNames?: string[];
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InlineInput({ initialValue = "", placeholder = "", depth, siblingNames = [], onSubmit, onCancel }: InlineInputProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus and select all text on mount
    const input = inputRef.current;
    if (input) {
      input.focus();
      if (initialValue) {
        // Select just the name part (before extension) for rename
        const dotIndex = initialValue.lastIndexOf(".");
        if (dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
        } else {
          input.select();
        }
      }
    }
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Validate on every change; clear error if empty (will be treated as cancel)
    if (!newValue || newValue.trim().length === 0) {
      setError(null);
    } else {
      const result = validateFileName(newValue, siblingNames);
      setError(result.valid ? null : (result.error ?? null));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      // Block submit if validation fails
      if (error) return;
      onSubmit(trimmed);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    // blur 一律取消，只有 Enter 才提交
    onCancel();
  };

  const paddingLeft = treeIndent(depth);

  return (
    <div style={{ paddingLeft }} className="pr-3 mx-1">
      <div className="flex items-center h-[32px]">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={`flex-1 bg-base border rounded-md px-2 py-1 text-[13px] text-t-primary font-mono outline-none transition-colors ${
            error ? "border-red-500 focus:border-red-500" : "border-neon/60 focus:border-neon"
          }`}
        />
      </div>
      {error && <div className="text-[12px] text-red-500 mt-1 px-2 leading-tight">{error}</div>}
    </div>
  );
}
