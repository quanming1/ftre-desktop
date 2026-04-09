import { useState, useCallback } from "react";
import { Plus, Trash2, ChevronLeft, ChevronDown, ChevronRight } from "lucide-react";
import { Input, Switch } from "@ftre/ui";
import { INITIAL_PROVIDERS, type ProviderConfig, type ModelConfig, type ProvidersConfig } from "./constants";

type ModelSettingsView = "list" | "edit";

interface ProviderFormData {
  name: string;
  api_key: string;
  base_url: string;
}

interface ModelFormData {
  displayName: string;
  model_id: string;
  parallel_tool_calls: boolean;
  vision: boolean;
  max_context_length: number;
}

export function ModelSettings() {
  const [providers, setProviders] = useState<ProvidersConfig>(() => ({ ...INITIAL_PROVIDERS }));
  const [view, setView] = useState<ModelSettingsView>("list");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderFormData>({
    name: "",
    api_key: "",
    base_url: "",
  });
  const [modelForms, setModelForms] = useState<Record<string, ModelFormData>>({});
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Reset forms
  const resetProviderForm = useCallback(() => {
    setProviderForm({ name: "", api_key: "", base_url: "" });
    setModelForms({});
    setExpandedModels({});
    setError(null);
  }, []);

  // Provider CRUD
  const handleAddProvider = () => {
    resetProviderForm();
    setEditingProvider(null);
    setView("edit");
  };

  const handleEditProvider = (providerName: string) => {
    const provider = providers[providerName];
    setProviderForm({
      name: providerName,
      api_key: provider.api_key,
      base_url: provider.base_url,
    });
    setModelForms({});
    setExpandedModels({});
    setError(null);
    setEditingProvider(providerName);
    setView("edit");
  };

  const handleDeleteProvider = (providerName: string) => {
    if (!confirm(`Delete provider "${providerName}"?`)) return;
    const newProviders = { ...providers };
    delete newProviders[providerName];
    setProviders(newProviders);
  };

  const handleSaveProvider = () => {
    if (!providerForm.name.trim()) {
      setError("Provider name is required");
      return;
    }

    // Build models from forms
    const models: Record<string, ModelConfig> = {};
    Object.entries(modelForms).forEach(([displayName, form]) => {
      if (displayName && form.model_id) {
        models[displayName] = {
          model_id: form.model_id,
          parallel_tool_calls: form.parallel_tool_calls,
          vision: form.vision,
          max_context_length: form.max_context_length,
        };
      }
    });

    const newProviders: ProvidersConfig = { ...providers };
    newProviders[providerForm.name] = {
      api_key: providerForm.api_key,
      base_url: providerForm.base_url,
      models,
    };

    setProviders(newProviders);
    setView("list");
    resetProviderForm();
    setEditingProvider(null);
  };

  const handleCancelEdit = () => {
    setView("list");
    resetProviderForm();
    setEditingProvider(null);
  };

  // Model CRUD
  const handleAddModel = () => {
    const newModelKey = `new-model-${Date.now()}`;
    setModelForms((prev) => ({
      ...prev,
      [newModelKey]: {
        displayName: "",
        model_id: "",
        parallel_tool_calls: false,
        vision: false,
        max_context_length: 128000,
      },
    }));
    setExpandedModels((prev) => ({ ...prev, [newModelKey]: true }));
  };

  const handleEditModel = (modelKey: string) => {
    const isNew = modelKey.startsWith("new-model-");
    if (isNew) {
      setExpandedModels((prev) => ({ ...prev, [modelKey]: true }));
      return;
    }

    // Editing existing model
    const provider = providers[editingProvider!];
    const model = provider.models[modelKey];
    setModelForms((prev) => ({
      ...prev,
      [modelKey]: {
        displayName: modelKey,
        model_id: model.model_id,
        parallel_tool_calls: model.parallel_tool_calls,
        vision: model.vision,
        max_context_length: model.max_context_length,
      },
    }));
    setExpandedModels((prev) => ({ ...prev, [modelKey]: true }));
  };

  const handleDeleteModel = (modelKey: string) => {
    const newForms = { ...modelForms };
    delete newForms[modelKey];
    setModelForms(newForms);
    const newExpanded = { ...expandedModels };
    delete newExpanded[modelKey];
    setExpandedModels(newExpanded);
  };

  const updateModelForm = (modelKey: string, field: keyof ModelFormData, value: string | boolean | number) => {
    setModelForms((prev) => ({
      ...prev,
      [modelKey]: { ...prev[modelKey], [field]: value },
    }));
  };

  // Render list view
  if (view === "list") {
    const providerList = Object.entries(providers);

    return (
      <div className="h-full flex flex-col">
        <div className="mb-16">
          <h1 className="text-[24px] font-light text-t-primary mb-2">Models</h1>
          <p className="text-[13px] text-t-dim">Configure AI providers and model settings</p>
        </div>

        <div className="flex-1">
          {providerList.length === 0 ? (
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
                {providerList.map(([name, config]) => (
                  <div
                    key={name}
                    className="group flex items-center justify-between py-4 border-b border-border/50 cursor-pointer hover:border-border transition-colors"
                    onClick={() => handleEditProvider(name)}
                  >
                    <div className="min-w-0">
                      <div className="text-[14px] text-t-primary group-hover:text-neon transition-colors">
                        {name}
                      </div>
                      <div className="text-[12px] text-t-ghost mt-1 truncate max-w-[300px]">
                        {Object.keys(config.models).length} models • {config.base_url}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProvider(name);
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

  // Render edit view
  const allModels = editingProvider
    ? { ...providers[editingProvider].models, ...modelForms }
    : modelForms;

  return (
    <div className="h-full flex flex-col">
      {/* Back link */}
      <button
        onClick={handleCancelEdit}
        className="inline-flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors mb-12"
      >
        <ChevronLeft size={14} />
        Back
      </button>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <h1 className="text-[24px] font-light text-t-primary mb-2">
          {editingProvider ? "Edit Provider" : "New Provider"}
        </h1>
        <p className="text-[13px] text-t-dim mb-12">
          Configure provider connection and models
        </p>

        {/* Error */}
        {error && <div className="text-[13px] text-[#f85149] mb-6">{error}</div>}

        {/* Provider form */}
        <div className="space-y-8 mb-16">
          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              Provider Name
            </label>
            <input
              value={providerForm.name}
              onChange={(e) => setProviderForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., dashscope"
              disabled={!!editingProvider}
              className="w-full text-[18px] font-light bg-transparent text-t-primary placeholder:text-t-ghost border-b border-border pb-3 focus:outline-none focus:border-neon transition-colors disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              API Key
            </label>
            <Input
              value={providerForm.api_key}
              onChange={(e) => setProviderForm((prev) => ({ ...prev, api_key: e.target.value }))}
              placeholder="sk-..."
              className="font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-3">
              Base URL
            </label>
            <Input
              value={providerForm.base_url}
              onChange={(e) => setProviderForm((prev) => ({ ...prev, base_url: e.target.value }))}
              placeholder="https://..."
            />
          </div>
        </div>

        {/* Models section */}
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

          {Object.keys(allModels).length === 0 ? (
            <p className="text-[13px] text-t-muted mb-6">No models configured yet.</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(allModels).map(([modelKey, model]) => {
                const isExpanded = expandedModels[modelKey] ?? false;
                const isNew = modelKey.startsWith("new-model-");
                const form = isNew || !editingProvider
                  ? modelForms[modelKey]
                  : { displayName: modelKey, ...model };

                return (
                  <div key={modelKey} className="border border-border rounded-lg overflow-hidden">
                    {/* Model header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 bg-elevated cursor-pointer hover:bg-elevated/80 transition-colors"
                      onClick={() => {
                        if (isExpanded) {
                          const newExpanded = { ...expandedModels };
                          delete newExpanded[modelKey];
                          setExpandedModels(newExpanded);
                        } else {
                          handleEditModel(modelKey);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-t-muted" />
                        ) : (
                          <ChevronRight size={16} className="text-t-muted" />
                        )}
                        <span className="text-[14px] text-t-primary">
                          {form.displayName || form.model_id || "(unnamed model)"}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteModel(modelKey);
                        }}
                        className="p-1.5 text-t-ghost hover:text-[#f85149] transition-colors"
                        title="Delete model"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Model form */}
                    {isExpanded && (
                      <div className="p-4 space-y-6 bg-surface">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-2">
                              Display Name
                            </label>
                            <Input
                              value={form.displayName || ""}
                              onChange={(e) => updateModelForm(modelKey, "displayName", e.target.value)}
                              placeholder="e.g., qwen3-max"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-2">
                              Model ID
                            </label>
                            <Input
                              value={form.model_id || ""}
                              onChange={(e) => updateModelForm(modelKey, "model_id", e.target.value)}
                              placeholder="e.g., qwen3-max-2026-01-23"
                              className="font-mono"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-2">
                            Max Context Length
                          </label>
                          <Input
                            type="number"
                            value={form.max_context_length || 128000}
                            onChange={(e) => updateModelForm(modelKey, "max_context_length", parseInt(e.target.value) || 0)}
                            placeholder="128000"
                            min={1}
                          />
                        </div>

                        <div className="flex items-center gap-8">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <Switch
                              checked={form.parallel_tool_calls || false}
                              onCheckedChange={(checked) => updateModelForm(modelKey, "parallel_tool_calls", checked)}
                              size="sm"
                            />
                            <span className="text-[13px] text-t-secondary">Parallel Tool Calls</span>
                          </label>

                          <label className="flex items-center gap-3 cursor-pointer">
                            <Switch
                              checked={form.vision || false}
                              onCheckedChange={(checked) => updateModelForm(modelKey, "vision", checked)}
                              size="sm"
                            />
                            <span className="text-[13px] text-t-secondary">Vision</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Save button */}
      <div className="mt-8 pt-6 border-t border-border">
        <button
          onClick={handleSaveProvider}
          className="px-8 py-3 text-[13px] font-medium text-base bg-neon hover:bg-neon-hover rounded transition-colors"
        >
          Save Provider
        </button>
      </div>
    </div>
  );
}
