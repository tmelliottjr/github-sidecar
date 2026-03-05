import { useForm } from '@tanstack/react-form';
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
    <div className="ve-overlay">
      <form
        className="ve-panel"
        onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      >
        <div className="ve-header">
          <h3 className="ve-title">{isEditing ? 'Edit View' : 'Create a View'}</h3>
          <button type="button" className="ve-close" onClick={onCancel}>×</button>
        </div>

        {!isEditing && (
          <div className="ve-templates">
            <p className="ve-section-label">Quick start</p>
            <div className="ve-template-grid">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className="ve-template-card"
                  onClick={() => applyTemplate(t)}
                >
                  <span className="ve-template-icon">{t.icon}</span>
                  <span className="ve-template-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ve-form-body">
          <div className="ve-section">
            <label className="ve-label" htmlFor="ve-name">Name</label>
            <form.Field name="name">
              {(field) => (
                <input
                  id="ve-name"
                  className="ve-input"
                  placeholder="e.g. My Open Issues"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  autoFocus
                />
              )}
            </form.Field>
          </div>

          <div className="ve-section">
            <p className="ve-label">Query type</p>
            <form.Field name="queryType">
              {(field) => (
                <div className="ve-query-types">
                  {(Object.keys(QUERY_TYPE_LABELS) as QueryType[]).map((qt) => (
                    <button
                      key={qt}
                      type="button"
                      className={`ve-qt-btn ${field.state.value === qt ? 've-qt-active' : ''}`}
                      onClick={() => field.handleChange(qt)}
                    >
                      <span className="ve-qt-label">{QUERY_TYPE_LABELS[qt].label}</span>
                      <span className="ve-qt-desc">{QUERY_TYPE_LABELS[qt].description}</span>
                    </button>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          <div className="ve-section">
            <div className="ve-section-header">
              <p className="ve-label">Filters</p>
              <form.Field name="useRawQuery">
                {(field) => (
                  <button
                    type="button"
                    className={`ve-raw-toggle ${field.state.value ? 've-raw-active' : ''}`}
                    onClick={() => field.handleChange(!field.state.value)}
                  >
                    {field.state.value ? '⊞ Structured' : '⌨ Raw query'}
                  </button>
                )}
              </form.Field>
            </div>

            <form.Field name="useRawQuery">
              {(rawField) => rawField.state.value ? (
                <form.Field name="rawQuery">
                  {(field) => (
                    <div className="ve-raw-section">
                      <input
                        className="ve-input ve-input-mono"
                        placeholder={`e.g. repo:org/repo label:bug`}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                      <p className="ve-hint">
                        This query will be combined with the query type above.
                        For {username}, this will search: <code>is:issue/pr {'{your query}'}</code>
                      </p>
                    </div>
                  )}
                </form.Field>
              ) : (
                <div className="ve-structured-filters">
                  <div className="ve-filter-row">
                    <div className="ve-filter-field">
                      <label className="ve-filter-label">State</label>
                      <form.Field name="state">
                        {(field) => (
                          <select
                            className="ve-select"
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
                    <div className="ve-filter-field ve-filter-field-grow">
                      <label className="ve-filter-label">Repository</label>
                      <form.Field name="repo">
                        {(field) => (
                          <input
                            className="ve-input"
                            placeholder="owner/repo (optional)"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        )}
                      </form.Field>
                    </div>
                  </div>
                  <div className="ve-filter-row">
                    <div className="ve-filter-field">
                      <label className="ve-filter-label">Sort by</label>
                      <form.Field name="sort">
                        {(field) => (
                          <select
                            className="ve-select"
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
                    <div className="ve-filter-field">
                      <label className="ve-filter-label">Order</label>
                      <form.Field name="order">
                        {(field) => (
                          <select
                            className="ve-select"
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

        <div className="ve-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <form.Subscribe selector={(s) => s.values.name}>
            {(name) => (
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
                {isEditing ? 'Save Changes' : 'Create View'}
              </button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </div>
  );
}
