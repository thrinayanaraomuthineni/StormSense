import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected rendering failure' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#283744] text-[#E5EDF3] flex items-center justify-center p-6">
          <div className="max-w-md w-full p-6 rounded-xl bg-[#43596A] border border-[#E36D6D]/50 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-[#F29B9B]">
              <AlertTriangle className="w-5 h-5" />
              <h2 className="font-display text-lg font-semibold">Application Error</h2>
            </div>
            <p className="text-xs text-[#AABBC9]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded bg-[#70A9CF] hover:bg-[#5D97BE] text-xs font-semibold text-[#1B2732] transition-colors"
            >
              Reload StormSense
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
