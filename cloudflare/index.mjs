export default {
  async fetch(request) {
    const url = new URL(request.url);
    const prefix = '/spark-inference';
    const suffix = url.pathname === prefix
      ? '/'
      : url.pathname.startsWith(prefix + '/')
        ? url.pathname.slice(prefix.length)
        : '/';

    const upstream = new URL('https://robertzaufall.github.io/spark-inference' + suffix);
    upstream.search = url.search;

    const upstreamReq = new Request(upstream.toString(), {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow'
    });
    upstreamReq.headers.set('Host', upstream.host);

    const resp = await fetch(upstreamReq);
    const contentType = resp.headers.get('content-type') || '';
    const headers = new Headers(resp.headers);
    headers.set('x-rob-proxy', 'spark-inference');
    headers.set('x-robots-tag', 'noindex, nofollow');

    if (contentType.includes('text/html')) {
      let html = await resp.text();
      if (!html.includes('<base ')) {
        html = html.replace(/<head(\s*?)>/i, '<head$1><base href="/spark-inference/">');
      }
      return new Response(html, {
        status: resp.status,
        statusText: resp.statusText,
        headers
      });
    }

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers
    });
  }
};
