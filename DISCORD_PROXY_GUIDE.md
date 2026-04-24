# 🛠️ Bypassing Hugging Face Network Restrictions

Hugging Face Free Tier Spaces block outgoing connections to certain messaging platforms (**Discord** and **Telegram**) via **TLS/SNI inspection**. This means the TCP connection is allowed, but the TLS handshake is silently dropped as soon as HF detects the target hostname (e.g., `discord.com`, `api.telegram.org`) in the SNI field.

The fix is to route your traffic through a **Cloudflare Worker proxy** with a neutral hostname. Since the SNI in the TLS handshake will show `your-proxy.workers.dev` instead of the blocked hostname, HF's filter won't block it. Cloudflare Workers are **100% free** (100,000 requests/day).

---

## Setting Up a Cloudflare Worker Proxy

This process takes about 2 minutes and works for both Discord and Telegram.

### Step 1: Create a Cloudflare Worker
1. Log into [Cloudflare](https://dash.cloudflare.com/) (create a free account if needed).
2. Go to **Workers & Pages** in the left sidebar.
3. Click **Create Worker** → **Start with Hello World!**.
4. Give it a name (e.g., `discord-proxy` or `telegram-proxy`) and click **Deploy**.

### Step 2: Add the Proxy Code
1. Click **Edit Code**.
2. Delete all existing code and paste the following snippet.
3. Replace `TARGET_HOSTNAME` with the service you want to proxy (see table below).

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'TARGET_HOSTNAME';
    return fetch(new Request(url, request));
  }
}
```

| Service | Replace `TARGET_HOSTNAME` with |
| :--- | :--- |
| Discord | `discord.com` |
| Telegram | `api.telegram.org` |

4. Click **Save and Deploy**. Cloudflare gives you a URL like `https://your-proxy.yourname.workers.dev`.

---

## Using the Proxy in n8n

### Discord
The native n8n Discord node uses Bot tokens that hardcode `discord.com`. Use the **Webhook** authentication method instead:

1. Add a **Discord** node and set the **Credential** to use **Webhook** authentication.
2. Create a new Discord Webhook credential.
3. Take your Discord Webhook URL and replace `discord.com` with your Worker domain:
   - *Original:* `https://discord.com/api/webhooks/123456/abcdef`
   - *Proxied:* `https://discord-proxy.yourname.workers.dev/api/webhooks/123456/abcdef`
4. Paste the proxied URL in the **Webhook URL** field.

### Telegram
The n8n Telegram credential has a **Base URL** field that can be changed:

1. Go to **Credentials** → add or edit a **Telegram** credential.
2. Enter your Bot Token as usual.
3. In the **Base URL** field, replace `https://api.telegram.org` with your Worker URL:
   - *Original:* `https://api.telegram.org`
   - *Proxied:* `https://telegram-proxy.yourname.workers.dev`
4. Click **Save** and then **Test** — it should connect instantly.

---

*Note: Upgrading your Hugging Face Space to a paid hardware tier removes these network restrictions entirely, allowing you to use all n8n nodes natively without a proxy.*
