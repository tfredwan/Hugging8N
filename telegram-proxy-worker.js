/**
 * Cloudflare Worker: Simple Telegram/Discord Proxy
 * 
 * Deployment:
 * 1. Go to dash.cloudflare.com -> Workers & Pages -> Create Worker.
 * 2. Paste this code and deploy.
 * 3. Use your worker URL (e.g., https://my-proxy.workers.dev) in Hugging8n.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Determine target based on path or header
    // Default to telegram if path matches telegram pattern
    let targetBase = "";
    if (url.pathname.startsWith("/bot")) {
      targetBase = "https://api.telegram.org";
    } else if (url.pathname.startsWith("/api/webhooks") || url.pathname.startsWith("/api/v")) {
      targetBase = "https://discord.com";
    } else {
      return new Response("Invalid request. Target not recognized.", { status: 400 });
    }

    const targetUrl = targetBase + url.pathname + url.search;
    
    // Copy headers and remove Cloudflare-specific ones
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("x-real-ip");

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "follow",
    });

    try {
      return await fetch(modifiedRequest);
    } catch (e) {
      return new Response(`Proxy Error: ${e.message}`, { status: 502 });
    }
  },
};
