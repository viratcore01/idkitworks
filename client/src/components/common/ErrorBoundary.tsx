import { Component, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
 hasError: boolean;
}

/** Catches any render-time crash and shows a recoverable screen instead of a white page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
 state: State = { hasError: false };

 static getDerivedStateFromError(): State {
 return { hasError: true };
 }

 componentDidCatch(error: Error, info: any) {
 // Hook Sentry/other reporting here
 console.error('[ErrorBoundary]', error.message, info?.componentStack);
 }

 render() {
 if (this.state.hasError) {
 return (
 <div className="min-h-dvh nb-canvas-surface flex items-center justify-center p-4">
 <div className="nb-card bg-white p-8 max-w-sm w-full text-center">
 <AlertTriangle size={44} strokeWidth={2.5} className="mx-auto mb-3 text-nb-violet" />
 <h1 className="font-display font-bold text-xl mb-1">Something broke</h1>
 <p className="font-body text-sm text-gray-500 mb-5">
 Don't worry — your data is safe. Reload to get back in.
 </p>
 <button
 onClick={() => window.location.reload()}
 className="nb-btn-orange w-full text-sm inline-flex items-center justify-center gap-1.5"
 >
 <RotateCcw size={14} strokeWidth={2.5} /> Reload Zoclo
 </button>
 </div>
 </div>
 );
 }
 return this.props.children;
 }
}
