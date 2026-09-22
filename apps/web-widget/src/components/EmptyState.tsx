interface EmptyStateProps {
  /** Large decorative glyph so pre-readers recognize the activity. */
  icon: string;
  title: string;
  hint?: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}

/**
 * First-run state for an activity: one big obvious tap target with an icon,
 * so a child who cannot read yet still knows where to begin.
 */
export const EmptyState = ({ icon, title, hint, actionLabel, onAction, disabled }: EmptyStateProps) => (
  <div className="empty-state">
    <span className="empty-state-icon" aria-hidden="true">{icon}</span>
    <p className="empty-state-title">{title}</p>
    {hint && <p className="hint">{hint}</p>}
    <button type="button" className="primary big" onClick={onAction} disabled={disabled}>
      {actionLabel}
    </button>
  </div>
);
