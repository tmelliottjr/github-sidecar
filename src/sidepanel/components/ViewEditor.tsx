import { useForm } from '@tanstack/react-form';
import { X, LayoutGrid, Terminal } from 'lucide-react';
import type { SavedView, QueryType, FilterState, ItemState, SortOption, SortOrder } from '../../types';

interface ViewEditorProps {
  existingView?: SavedView;
  onSave: (name: string, queryType: QueryType, filters: FilterState) => void;
  onCancel: () => void;
  username: string;
}

const QUERY_TYPE_LABELS: Record<QueryType, { label: string; description: string }> = {
  issues: { label: 'Issues', description: 'Issues assigned to you' },
  prs: { label: 'Pull Requests', description: 'PRs authored by you' },
  reviews: { label: 'Reviews', description: 'PRs requesting your review' },
};

interface ViewFormValues {
  name: string;
  queryType: QueryType;
  useRawQuery: boolean;
  rawQuery: string;
  state: ItemState;
  repo: string;
  sort: SortOption;
  order: SortOrder;
}

const TEMPLATES: { name: string; queryType: QueryType; icon: string }[] = [
  { name: 'My Issues', queryType: 'issues', icon: '🔵' },
  { name: 'My Pull Requests', queryType: 'prs', icon: '🟢' },
  { name: 'Review Requests', queryType: 'reviews', icon: '🟡' },
  { name: 'My Closed PRs', queryType: 'prs', icon: '🟣' },
];

function getTemplateFilters(name: string): Partial<ViewFormValues> {
  if (name === 'My Closed PRs') return { state: 'closed' as ItemState };
  return {};
}

const inputClass = 'w-full bg-bg-primary border border-border rounded-md py-[7px] px-2.5 text-text-primary text-[13px] placeholder:text-text-secondary focus:outline-none focus:border-text-link focus:ring-2 focus:ring-text-link/15';
const selectClass = 'w-full bg-bg-primary border border-border rounded-md py-[7px] px-2.5 text-text-primary text-xs cursor-pointer focus:outline-none focus:border-text-link';

export function ViewEditor({ existingView, onSave, onCancel, username }: ViewEditorProps) {
  const isEditing = !!existingView;

  const form = useForm({
    defaultValues: {
      name: existingView?.name ?? '',
      queryType: (existingView?.queryType ?? 'issues') as QueryType,
      useRawQuery: !!existingView?.filters.rawQuery,
      rawQuery: existingView?.filters.rawQuery ?? '',
      state: (existingView?.filters.state ?? 'open') as ItemState,
      repo: existingView?.filters.repo ?? '',
      sort: (existingView?.filters.sort ?? 'updated') as SortOption,
      order: (existingView?.filters.order ?? 'desc') as SortOrder,
    },
    onSubmit: ({ value }) => {
      const filters: FilterState = {
        state: value.state as ItemState,
        repo: value.repo,
        sort: value.sort as SortOption,
        order: value.order as SortOrder,
        rawQuery: value.useRawQuery ? value.rawQuery : undefined,
      };
      onSave(value.name, value.queryType as QueryType, filters);
    },
  });

  const applyTemplate = (template: typeof TEMPLATES[0]) => {
    const overrides = getTemplateFilters(template.name);
    form.setFieldValue('name', template.name);
    form.setFieldValue('queryType', template.queryType);
    form.setFieldValue('state', overrides.state ?? 'open' as ItemState);
    form.setFieldValue('useRawQuery', false);
  };

  return (
    <div className="p-4 animate-slide-in">
      <form
        className="bg-bg-secondary border border-border rounded-[10px] overflow-hidden"
        onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      >
        {/* Header */}
        <div className="flex items-center justify-between py-3 px-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">{isEditing ? 'Edit View' : 'Create a View'}</h3>
          <button
            type="button"
            className="bg-transparent border-none text-text-secondary text-lg cursor-pointer px-1 rounded leading-none transition-colors hover:text-text-primary hover:bg-bg-tertiary"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>

        {/* Templates */}
        {!isEditing && (
          <div className="py-3 px-4 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">Quick start</p>
            <div className="grid grid-cols-2 gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className="flex items-center gap-1.5 bg-bg-tertiary border border-border rounded-lg py-2 px-2.5 cursor-pointer transition-[background,border-color] text-left hover:bg-border hover:border-text-secondary"
                  onClick={() => applyTemplate(t)}
                >
                  <span className="text-sm shrink-0">{t.icon}</span>
                  <span className="text-[11px] font-medium text-text-primary">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Form Body */}
        <div className="py-3 px-4">
          {/* Name */}
          <div className="mb-3.5">
            <label className="text-[11px] font-semibold text-text-secondary mb-1.5 block" htmlFor="ve-name">Name</label>
            <form.Field name="name">
              {(field) => (
                <input
                  id="ve-name"
                  className={inputClass}
                  placeholder="e.g. My Open Issues"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  autoFocus
                />
              )}
            </form.Field>
          </div>

          {/* Query Type */}
          <div className="mb-3.5">
            <p className="text-[11px] font-semibold text-text-secondary mb-1.5 block">Query type</p>
            <form.Field name="queryType">
              {(field) => (
                <div className="flex flex-col gap-1">
                  {(Object.keys(QUERY_TYPE_LABELS) as QueryType[]).map((qt) => (
                    <button
                      key={qt}
                      type="button"
                      className={`flex flex-col items-start gap-px bg-bg-tertiary border rounded-lg py-2 px-3 cursor-pointer transition-[background,border-color] text-left hover:bg-border ${
                        field.state.value === qt
                          ? 'bg-text-link/10 border-text-link'
                          : 'border-border'
                      }`}
                      onClick={() => field.handleChange(qt)}
                    >
                      <span className="text-xs font-semibold text-text-primary">{QUERY_TYPE_LABELS[qt].label}</span>
                      <span className="text-[10px] text-text-secondary">{QUERY_TYPE_LABELS[qt].description}</span>
                    </button>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          {/* Filters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-text-secondary">Filters</p>
              <form.Field name="useRawQuery">
                {(field) => (
                  <button
                    type="button"
                    className={`bg-bg-tertiary border rounded-md text-text-secondary py-0.5 px-2 text-[10px] cursor-pointer transition-[background,color] hover:bg-border hover:text-text-primary ${
                      field.state.value
                        ? 'bg-text-link/15 border-text-link text-text-link'
                        : 'border-border'
                    }`}
                    onClick={() => field.handleChange(!field.state.value)}
                  >
                    {field.state.value ? <><LayoutGrid size={10} className="inline" /> Structured</> : <><Terminal size={10} className="inline" /> Raw query</>}
                  </button>
                )}
              </form.Field>
            </div>

            <form.Field name="useRawQuery">
              {(rawField) => rawField.state.value ? (
                <form.Field name="rawQuery">
                  {(field) => (
                    <div className="flex flex-col gap-1.5">
                      <input
                        className={`${inputClass} font-mono text-xs`}
                        placeholder={`e.g. repo:org/repo label:bug`}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <p className="text-[10px] text-text-secondary leading-snug">
                        This query will be combined with the query type above.
                        For {username}, this will search: <code className="bg-bg-tertiary px-1 rounded text-[10px]">is:issue/pr {'{your query}'}</code>
                      </p>
                    </div>
                  )}
                </form.Field>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10px] text-text-secondary">State</label>
                      <form.Field name="state">
                        {(field) => (
                          <select
                            className={selectClass}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as ItemState)}
                          >
                            <option value="open">Open</option>
                            <option value="closed">Closed</option>
                            <option value="all">All</option>
                          </select>
                        )}
                      </form.Field>
                    </div>
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <label className="text-[10px] text-text-secondary">Repository</label>
                      <form.Field name="repo">
                        {(field) => (
                          <input
                            className={inputClass}
                            placeholder="owner/repo (optional)"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        )}
                      </form.Field>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10px] text-text-secondary">Sort by</label>
                      <form.Field name="sort">
                        {(field) => (
                          <select
                            className={selectClass}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as SortOption)}
                          >
                            <option value="updated">Updated</option>
                            <option value="created">Created</option>
                            <option value="comments">Comments</option>
                          </select>
                        )}
                      </form.Field>
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10px] text-text-secondary">Order</label>
                      <form.Field name="order">
                        {(field) => (
                          <select
                            className={selectClass}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as SortOrder)}
                          >
                            <option value="desc">Newest first</option>
                            <option value="asc">Oldest first</option>
                          </select>
                        )}
                      </form.Field>
                    </div>
                  </div>
                </div>
              )}
            </form.Field>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 py-3 px-4 border-t border-border">
          <button
            type="button"
            className="bg-bg-tertiary text-text-primary border border-border rounded-md px-4 py-1.5 text-[13px] font-medium cursor-pointer transition-colors hover:bg-border"
            onClick={onCancel}
          >
            Cancel
          </button>
          <form.Subscribe selector={(s) => s.values.name}>
            {(name) => (
              <button
                type="submit"
                className="border-none rounded-md px-4 py-1.5 text-[13px] font-medium cursor-pointer bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!name.trim()}
              >
                {isEditing ? 'Save Changes' : 'Create View'}
              </button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </div>
  );
}
