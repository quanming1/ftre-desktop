# LLM Provider Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate backend LLM provider configuration API into the existing Settings > Models page, replacing mock data with real API calls.

**Architecture:** Direct refactoring of `ModelSettings.tsx` to fetch/mutate providers via new API functions in `api.ts`. The component maintains local form state and syncs with backend on save. Models use simplified `{ alias: model_name }` format matching the backend.

**Tech Stack:** React, TypeScript, fetch API, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/renderer/src/services/api.ts` | Modify | Add LLM Provider CRUD functions |
| `packages/renderer/src/features/settings/ModelSettings.tsx` | Rewrite | Refactor to use API, simplify model structure |
| `packages/renderer/src/features/settings/constants.ts` | Modify | Remove `INITIAL_PROVIDERS` and related types |

---

## Task 1: Add LLM Provider API Functions

**Files:**
- Modify: `packages/renderer/src/services/api.ts` (append at end)

- [ ] **Step 1: Add type definitions**

Add to `api.ts` after the last export:

```typescript
// ─── LLM Provider API ────────────────────────────────────────────

export interface LLMProvider {
  vendor: string;
  base_url: string;
  api_key?: string;
  models: Record<string, string>;
  api_type?: string;
}

export interface LLMProviderPayload {
  api_key: string;
  base_url: string;
  models: Record<string, string>;
  api_type?: string;
}
```

- [ ] **Step 2: Add fetchLLMProviders function**

```typescript
/** 获取所有 LLM 供应商 */
export async function fetchLLMProviders(): Promise<LLMProvider[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/llm/providers`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.providers || [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Add createLLMProvider function**

```typescript
/** 新增 LLM 供应商 */
export async function createLLMProvider(
  vendor: string,
  payload: LLMProviderPayload,
): Promise<LLMProvider | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/llm/providers?vendor=${encodeURIComponent(vendor)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add updateLLMProvider function**

```typescript
/** 更新 LLM 供应商 */
export async function updateLLMProvider(
  vendor: string,
  payload: LLMProviderPayload,
): Promise<LLMProvider | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/llm/providers/${encodeURIComponent(vendor)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Add deleteLLMProvider function**

```typescript
/** 删除 LLM 供应商 */
export async function deleteLLMProvider(vendor: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/llm/providers/${encodeURIComponent(vendor)}`,
      {
        method: "DELETE",
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Commit API changes**

```bash
git add packages/renderer/src/services/api.ts
git commit -m "feat(api): add LLM provider CRUD functions"
```

---

## Task 2: Clean Up Constants

**Files:**
- Modify: `packages/renderer/src/features/settings/constants.ts`

- [ ] **Step 1: Remove INITIAL_PROVIDERS and related types**

Remove these lines from `constants.ts`:

```typescript
// DELETE: Lines 3-18 (ModelConfig, ProviderConfig, ProvidersConfig types)
// DELETE: Lines 22-77 (INITIAL_PROVIDERS constant)
```

Keep only the `AVAILABLE_TOOLS` export.

The file should now contain only:

```typescript
import type { SelectOption } from "@ftre/ui";

// ==================== Tools Config ====================

export const AVAILABLE_TOOLS: SelectOption[] = [
  // File Operations
  { value: "read", label: "read", group: "File" },
  { value: "write", label: "write", group: "File" },
  { value: "edit", label: "edit", group: "File" },
  { value: "glob", label: "glob", group: "File" },
  { value: "grep", label: "grep", group: "File" },

  // Execution
  { value: "bash", label: "bash", group: "Execution" },
  { value: "task", label: "task", group: "Execution" },

  // Search & Analysis
  { value: "workspace_search", label: "workspace_search", group: "Search" },

  // Communication
  { value: "send_email", label: "send_email", group: "Communication" },
  { value: "check_email", label: "check_email", group: "Communication" },

  // Memory
  { value: "load_skill", label: "load_skill", group: "Memory" },
  { value: "recall", label: "recall", group: "Memory" },
  { value: "read_message", label: "read_message", group: "Memory" },

  // Thinking
  { value: "think", label: "think", group: "Thinking" },
];
```

- [ ] **Step 2: Commit constants cleanup**

```bash
git add packages/renderer/src/features/settings/constants.ts
git commit -m "refactor(settings): remove mock provider data from constants"
```

---

## Task 3: Rewrite ModelSettings Component - Types and Imports

**Files:**
- Modify: `packages/renderer/src/features/settings/ModelSettings.tsx`

- [ ] **Step 1: Replace imports and type definitions**

Replace the entire file with this foundation:

```typescript
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ChevronLeft } from "lucide-react";
import { Input } from "@ftre/ui";
import {
  fetchLLMProviders,
  createLLMProvider,
  updateLLMProvider,
  deleteLLMProvider,
  type LLMProvider,
} from "@/services/api";

type ModelSettingsView = "list" | "edit";

interface ModelEntry {
  alias: string;
  model_name: string;
}

interface ProviderFormData {
  vendor: string;
  api_key: string;
  base_url: string;
  api_type: string;
  models: ModelEntry[];
}

function emptyForm(): ProviderFormData {
  return {
    vendor: "",
    api_key: "",
    base_url: "",
    api_type: "completions",
    models: [],
  };
}

function providerToForm(provider: LLMProvider): ProviderFormData {
  return {
    vendor: provider.vendor,
    api_key: "",
    base_url: provider.base_url,
    api_type: provider.api_type || "completions",
    models: Object.entries(provider.models).map(([alias, model_name]) => ({
      alias,
      model_name,
    })),
  };
}

function formToPayload(form: ProviderFormData) {
  const models: Record<string, string> = {};
  for (const m of form.models) {
    if (m.alias.trim() && m.model_name.trim()) {
      models[m.alias.trim()] = m.model_name.trim();
    }
  }
  return {
    api_key: form.api_key,
    base_url: form.base_url,
    models,
    api_type: form.api_type || "completions",
  };
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd packages/renderer && npx tsc --noEmit`
Expected: No errors (or only unrelated existing errors)

---

## Task 4: Rewrite ModelSettings - List View

**Files:**
- Modify: `packages/renderer/src/features/settings/ModelSettings.tsx` (append after helper functions)

- [ ] **Step 1: Add the main component with list view**

Append to the file:

```typescript
export function ModelSettings() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ModelSettingsView>("list");
  const [editingVendor, setEditingVendor] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLLMProviders();
      setProviders(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleAddProvider = () => {
    setForm(emptyForm());
    setEditingVendor(null);
    setError(null);
    setView("edit");
  };

  const handleEditProvider = (provider: LLMProvider) => {
    setForm(providerToForm(provider));
    setEditingVendor(provider.vendor);
    setError(null);
    setView("edit");
  };

  const handleDeleteProvider = async (vendor: string) => {
    if (!confirm(`Delete provider "${vendor}"?`)) return;
    const success = await deleteLLMProvider(vendor);
    if (success) {
      await loadProviders();
    }
  };

  const handleCancelEdit = () => {
    setView("list");
    setForm(emptyForm());
    setEditingVendor(null);
    setError(null);
  };

  // List view
  if (view === "list") {
    return (
      <div className="h-full flex flex-col">
        <div className="mb-16">
          <h1 className="text-[24px] font-light text-t-primary mb-2">Models</h1>
          <p className="text-[13px] text-t-dim">Configure AI providers and model settings</p>
        </div>

        <div className="flex-1">
          {loading ? (
            <div className="text-[13px] text-t-ghost">Loading...</div>
          ) : providers.length === 0 ? (
            <div>
              <p className="text-[14px] text-t-muted leading-relaxed mb-8">
                No providers configured yet. Add a provider to get started.
              </p>
              <button
                onClick={handleAddProvider}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors"
              >
                <Plus size={16} strokeWidth={2} />
                Add Provider
              </button>
            </div>
          ) : (
            <div>
              <div className="space-y-1 mb-12">
                {providers.map((provider) => (
                  <div
                    key={provider.vendor}
                    className="group flex items-center justify-between py-4 border-b border-border/50 cursor-pointer hover:border-border transition-colors"
                    onClick={() => handleEditProvider(provider)}
                  >
                    <div className="min-w-0">
                      <div className="text-[14px] text-t-primary group-hover:text-neon transition-colors">
                        {provider.vendor}
                      </div>
                      <div className="text-[12px] text-t-ghost mt-1 truncate max-w-[300px]">
                        {Object.keys(provider.models).length} models • {provider.base_url}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProvider(provider.vendor);
                      }}
                      className="p-2 opacity-0 group-hover:opacity-100 text-t-ghost hover:text-[#f85149] transition-all"
                      title="Delete provider"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={handleAddProvider}
                className="inline-flex items-center gap-2 text-[13px] text-t-dim hover:text-neon transition-colors"
              >
                <Plus size={14} />
                Add another provider
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit view placeholder - will be added in next task
  return null;
}
```

- [ ] **Step 2: Verify list view compiles**

Run: `cd packages/renderer && npx tsc --noEmit`
Expected: No errors related to ModelSettings

---

## Task 5: Rewrite ModelSettings - Edit View

**Files:**
- Modify: `packages/renderer/src/features/settings/ModelSettings.tsx`

- [ ] **Step 1: Replace the `return null` placeholder with edit view**

Replace `// Edit view placeholder - will be added in next task` and `return null;` with:

```typescript
  // Form handlers
  const handleSave = async () => {
    if (!form.vendor.trim()) {
      setError("Provider name is required");
      return;
    }
    if (!editingVendor && !form.api_key.trim()) {
      setError("API key is required for new providers");
      return;
    }
    if (!form.base_url.trim()) {
      setError("Base URL is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = formToPayload(form);
      const result = editingVendor
        ? await updateLLMProvider(editingVendor, payload)
        : await createLLMProvider(form.vendor, payload);

      if (!result) {
        setError("Failed to save provider");
        return;
      }

      await loadProviders();
      handleCancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = () => {
    setForm((prev) => ({
      ...prev,
      models: [...prev.models, { alias: "", model_name: "" }],
    }));
  };

  const handleRemoveModel = (index: number) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.filter((_, i) => i !== index),
    }));
  };

  const handleModelChange = (index: number, field: "alias" | "model_name", value: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    }));
  };

  // Edit view
  return (
    <div className="h-full flex flex-col">
      <button
        onClick={handleCancelEdit}
        className="inline-flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors mb-12"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      <div className="flex-1 overflow-auto">
        <h1 className="text-[24px] font-light text-t-primary mb-2">
          {editingVendor ? "Edit Provider" : "New Provider"}
        </h1>
        <p className="text-[13px] text-t-dim mb-12">
          Configure provider connection and models
        </p>

        {error && <div className="text-[13px] text-[#f85149] mb-6">{error}</div>}

        <div className="space-y-8 mb-16">
          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              Provider Name
            </label>
            <input
              value={form.vendor}
              onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
              placeholder="e.g., openai"
              disabled={!!editingVendor}
              className="w-full text-[18px] font-light bg-transparent text-t-primary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              API Key {editingVendor && "(leave empty to keep current)"}
            </label>
            <Input
              value={form.api_key}
              onChange={(e) => setForm((prev) => ({ ...prev, api_key: e.target.value }))}
              placeholder="sk-..."
              className="font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              Base URL
            </label>
            <Input
              value={form.base_url}
              onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              API Type
            </label>
            <Input
              value={form.api_type}
              onChange={(e) => setForm((prev) => ({ ...prev, api_type: e.target.value }))}
              placeholder="completions"
            />
          </div>
        </div>

        <div className="border-t border-border pt-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[16px] font-medium text-t-primary">Models</h2>
            <button
              onClick={handleAddModel}
              className="inline-flex items-center gap-2 text-[13px] text-t-dim hover:text-neon transition-colors"
            >
              <Plus size={14} />
              Add Model
            </button>
          </div>

          {form.models.length === 0 ? (
            <p className="text-[13px] text-t-muted mb-6">No models configured yet.</p>
          ) : (
            <div className="space-y-4">
              {form.models.map((model, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="flex-1">
                    <Input
                      value={model.alias}
                      onChange={(e) => handleModelChange(index, "alias", e.target.value)}
                      placeholder="Alias (e.g., gpt4)"
                    />
                  </div>
                  <span className="text-t-ghost">→</span>
                  <div className="flex-1">
                    <Input
                      value={model.model_name}
                      onChange={(e) => handleModelChange(index, "model_name", e.target.value)}
                      placeholder="Model ID (e.g., gpt-4)"
                      className="font-mono"
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveModel(index)}
                    className="p-2 text-t-ghost hover:text-[#f85149] transition-colors"
                    title="Remove model"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-border">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-3 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Provider"}
        </button>
      </div>
    </div>
  );
```

- [ ] **Step 2: Verify complete component compiles**

Run: `cd packages/renderer && npx tsc --noEmit`
Expected: No errors related to ModelSettings

- [ ] **Step 3: Commit ModelSettings rewrite**

```bash
git add packages/renderer/src/features/settings/ModelSettings.tsx
git commit -m "feat(settings): integrate LLM provider API into ModelSettings

- Fetch providers from backend on mount
- Add/edit/delete providers via API
- Simplified model format: { alias: model_name }
- Added api_type field support"
```

---

## Task 6: Manual Testing

**Files:**
- None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `cd packages/renderer && npm run dev`

- [ ] **Step 2: Open Settings > Models**

1. Click the settings icon in the title bar
2. Click on "Models" category
3. Verify the list loads (may be empty if no providers exist)

- [ ] **Step 3: Test add provider**

1. Click "Add Provider"
2. Fill in:
   - Provider Name: `test-provider`
   - API Key: `sk-test-123`
   - Base URL: `https://api.example.com/v1`
   - API Type: `completions`
3. Click "Add Model" and fill in:
   - Alias: `gpt4`
   - Model ID: `gpt-4`
4. Click "Save Provider"
5. Verify you return to list and see the new provider

- [ ] **Step 4: Test edit provider**

1. Click on the provider row
2. Verify form is pre-filled (api_key empty)
3. Modify base_url
4. Click "Save Provider"
5. Verify changes persist

- [ ] **Step 5: Test delete provider**

1. Hover over provider row
2. Click trash icon
3. Confirm deletion
4. Verify provider removed from list

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: cleanup after LLM provider integration"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Add LLM Provider API functions | 5 min |
| 2 | Clean up constants | 2 min |
| 3 | ModelSettings - Types and imports | 3 min |
| 4 | ModelSettings - List view | 5 min |
| 5 | ModelSettings - Edit view | 8 min |
| 6 | Manual testing | 10 min |

**Total: ~33 minutes**
