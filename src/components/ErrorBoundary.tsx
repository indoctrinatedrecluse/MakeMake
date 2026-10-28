import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, copied: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('CRITICAL UNCAUGHT REACT EXCEPTION:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleCopy = () => {
    const text = `MakeMake Error Report:\n${this.state.error?.stack || this.state.error?.message}\n\nComponent Stack:\n${this.state.errorInfo?.componentStack}`;
    navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-obsidian-950 text-slate-100 font-mono select-none">
          <div className="w-full max-w-2xl p-6 rounded-lg bg-obsidian-900 border border-cyber-red/60 shadow-[0_0_30px_rgba(255,42,109,0.3)] space-y-4">
            {/* Header */}
            <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
              <div className="p-2.5 rounded bg-cyber-red/20 text-cyber-red border border-cyber-red/40 animate-pulse">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold font-cyber tracking-wider text-cyber-red">
                  MAKEMAKE // RUNTIME TELEMETRY ANOMALY
                </h2>
                <div className="text-[11px] text-slate-400">
                  THE SACRED SWARM ENCOUNTERED AN UNCAUGHT EXCEPTION
                </div>
              </div>
            </div>

            {/* Error Message */}
            <div className="p-3 rounded bg-obsidian-950 border border-slate-800 text-xs text-rose-300 font-bold overflow-x-auto">
              {this.state.error?.toString()}
            </div>

            {/* Stack Trace */}
            {this.state.error?.stack && (
              <div className="max-h-48 overflow-y-auto p-3 rounded bg-obsidian-950/80 border border-slate-800/80 text-[10px] text-slate-400 font-mono leading-relaxed">
                <pre className="whitespace-pre-wrap">{this.state.error.stack}</pre>
              </div>
            )}

            {/* Recovery Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                onClick={this.handleCopy}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-colors border border-slate-700"
              >
                {this.state.copied ? <Check className="w-3.5 h-3.5 text-cyber-green" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{this.state.copied ? 'COPIED TO CLIPBOARD' : 'COPY ERROR TELEMETRY'}</span>
              </button>

              <button
                onClick={this.handleReload}
                className="cyber-button px-5 py-2 bg-cyber-cyan text-black font-bold font-mono text-xs uppercase tracking-wider flex items-center space-x-1.5 shadow-glow-cyan"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>RE-ENGAGE SWARM</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
