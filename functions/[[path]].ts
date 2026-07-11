/**
 * Cloudflare Pages Functions - API Proxy to Worker
 * Routes /api/* requests to Worker, handles static assets and HTML routing
 * 
 * __WORKER_URL__ is replaced at build time by GitHub Actions
 */

export const onRequest: PagesFunction = async (context) => {
	const { request, env } = context;
	const url = new URL(request.url);
	const pathname = url.pathname;
	const isApiRoute = pathname.startsWith('/api/');
	const isR2Route = pathname.startsWith('/r2/');

	if (!isApiRoute && !isR2Route) {
		return context.next();
	}

	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS, PUT, DELETE',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Timestamp, X-Nonce',
	};

	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: corsHeaders });
	}

	try {
		const isLocalDev = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

		// Priority: 1) env var (set via Pages secret), 2) build-time constant, 3) local dev fallback
		const workerUrl = (env.WORKER_URL as string) ||
			'__WORKER_URL__' ||
			(isLocalDev ? 'http://localhost:8787' : null);

		if (!workerUrl) {
			return Response.json(
				{ error: 'Worker URL not configured - set WORKER_URL Pages secret or redeploy' },
				{ status: 502, headers: corsHeaders }
			);
		}

		const forwardUrl = new URL(pathname + url.search, workerUrl);

		const forwardHeaders = new Headers(request.headers);
		forwardHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
		forwardHeaders.set('X-Forwarded-Host', url.hostname);
		forwardHeaders.set('X-Original-URL', url.origin);
		forwardHeaders.set('Host', new URL(workerUrl).hostname);

		const response = await fetch(new Request(forwardUrl.toString(), {
			method: request.method,
			headers: forwardHeaders,
			body: request.body,
		}));

		const headers = new Headers(response.headers);
		Object.entries(corsHeaders).forEach(([key, val]) => headers.set(key, val));

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});

	} catch (error) {
		console.error('API proxy error:', error);
		return Response.json(
			{
				error: 'Failed to forward API request',
				message: String(error),
			},
			{ status: 502, headers: corsHeaders }
		);
	}
};
