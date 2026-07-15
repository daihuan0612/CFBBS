import React from 'react';

interface ErrorBoundaryProps {
	children: React.ReactNode;
	fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(): ErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error('ErrorBoundary caught an error:', error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;
			return (
				<div className="rounded-md border border-destructive/50 bg-destructive/5 p-6 text-center">
					<p className="text-sm text-destructive font-medium">内容加载失败</p>
					<p className="mt-1 text-xs text-muted-foreground">
						<button
							type="button"
							className="underline hover:text-foreground"
							onClick={() => this.setState({ hasError: false })}
						>
							点击重试
						</button>
					</p>
				</div>
			);
		}

		return this.props.children;
	}
}
