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
    api_key: provider.api_key,
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
    setError(null);
    try {
      const data = await fetchLLMProviders();
      setProviders(data);
    } catch {
      setError("Failed to load providers");
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
    } else {
      setError("Failed to delete provider");
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

  // Form handlers
  const handleSave = async () => {
    if (!form.vendor.trim()) {
      setError("Provider name is required");
      return;
    }
    if (!form.api_key.trim()) {
      setError("API key is required");
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
              API Key
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
}
