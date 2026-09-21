import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ActivityErrorBoundaryProps {
  /** Activity name shown in the recovery message, e.g. "Coloring Corner". */
  activity: string;
  children: ReactNode;
}

interface ActivityErrorBoundaryState {
  failed: boolean;
  resetKey: number;
}

/**
 * Keeps one broken activity from blanking the whole widget. A render error
 * inside a tab shows a friendly message with a button that remounts just
 * that activity. Diagnostics go to the console, never to the child.
 */
export class ActivityErrorBoundary extends Component<
  ActivityErrorBoundaryProps,
  ActivityErrorBoundaryState
> {
  override state: ActivityErrorBoundaryState = { failed: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<ActivityErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[kidbot] ${this.props.activity} crashed:`, error, info.componentStack);
  }

  private readonly handleReset = () => {
    this.setState((prev) => ({ failed: false, resetKey: prev.resetKey + 1 }));
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className="panel activity-error" role="alert">
          <h2>Oops!</h2>
          <p>{this.props.activity} hit a snag. Your other activities are fine.</p>
          <button type="button" onClick={this.handleReset}>
            Try {this.props.activity} again
          </button>
        </section>
      );
    }
    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}
