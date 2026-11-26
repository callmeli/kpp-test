import { Component, ErrorInfo, ReactNode } from 'react';
import { trackError } from './utils/analytics';

/** 渲染出错时给一个重新加载按钮（不清本机进度） */
export class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error(err, info); trackError(err, info.componentStack || ''); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="boot">
        <p>Something went wrong · 出错了 · Ralat</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        {import.meta.env.DEV && <pre className="small">{String(this.state.err.stack)}</pre>}
      </div>
    );
  }
}
