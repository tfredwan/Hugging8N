/**
 * DNS fix preload script for HF Spaces.
 *
 * Patches Node.js dns.lookup to:
 * 1. Try DNS-over-HTTPS (Cloudflare) first to bypass DNS sinkholing
 * 2. Fall back to system DNS if DoH fails
 *    (This is needed because HF Spaces intercepts/blocks some domains like
 *    WhatsApp web or Telegram API via standard UDP DNS).
 *
 * Loaded via: NODE_OPTIONS="--require /opt/dns-fix.js"
 */
"use strict";

console.error("[DNS-FIX] dns-fix.js preload script loaded successfully.");

const dns = require("dns");
const http = require("http");
const https = require("https");

// ── Keep-Alive Fix ────────────────────────────────────────────────────────────
http.globalAgent = new http.Agent({ keepAlive: false });
https.globalAgent = new https.Agent({ keepAlive: false });
// ─────────────────────────────────────────────────────────────────────────────

// ── TCP Connection Diagnostics ────────────────────────────────────────────────
// Temporarily patch net.createConnection to log all outgoing TCP connections
// and their errors so we can identify the exact IP and failure mode.
const net = require("net");
const _origConnect = net.createConnection.bind(net);
net.createConnection = function (options, ...args) {
  const host = options.host || options;
  const port = options.port;
  // Only log external connections (skip loopback)
  if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    console.error(`[DNS-FIX] TCP connect → ${host}:${port}`);
    const sock = _origConnect(options, ...args);
    sock.on("connect", () =>
      console.error(`[DNS-FIX] TCP connected ✓ ${host}:${port}`),
    );
    sock.on("error", (err) =>
      console.error(`[DNS-FIX] TCP error ✗ ${host}:${port} — ${err.code}: ${err.message}`),
    );
    return sock;
  }
  return _origConnect(options, ...args);
};
// ─────────────────────────────────────────────────────────────────────────────

// In-memory cache for runtime DoH resolutions
const runtimeCache = new Map(); // hostname -> { ip, expiry }

// DNS-over-HTTPS resolver
function dohResolve(hostname, callback) {
  // Check runtime cache
  const cached = runtimeCache.get(hostname);
  if (cached && cached.expiry > Date.now()) {
    return callback(null, cached.ip);
  }

  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const req = https.get(
    url,
    { headers: { Accept: "application/dns-json" }, timeout: 15000 },
    (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const aRecords = (data.Answer || []).filter((a) => a.type === 1);
          if (aRecords.length === 0) {
            return callback(new Error(`DoH: no A record for ${hostname}`));
          }
          const ip = aRecords[0].data;
          const ttl = Math.max((aRecords[0].TTL || 300) * 1000, 60000);
          runtimeCache.set(hostname, { ip, expiry: Date.now() + ttl });
          callback(null, ip);
        } catch (e) {
          callback(new Error(`DoH parse error: ${e.message}`));
        }
      });
    }
  );
  req.on("error", (e) => callback(new Error(`DoH request failed: ${e.message}`)));
  req.on("timeout", () => {
    req.destroy();
    callback(new Error("DoH request timed out"));
  });
}

// Monkey-patch dns.lookup
const origLookup = dns.lookup;

dns.lookup = function patchedLookup(hostname, options, callback) {
  // Normalize arguments (options is optional, can be number or object)
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (typeof options === "number") {
    options = { family: options };
  }
  options = options || {};

  // Skip patching for localhost, IPs, and internal domains
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^::/.test(hostname) ||
    hostname === "cloudflare-dns.com"
  ) {
    return origLookup.call(dns, hostname, options, callback);
  }

  // 1) Try DoH first to bypass HF DNS sinkholing (which returns fake IPs instead of ENOTFOUND)
  dohResolve(hostname, (dohErr, ip) => {
    if (!dohErr && ip) {
      if (options.all) {
        return callback(null, [{ address: ip, family: 4 }]);
      }
      return callback(null, ip, 4);
    }

    console.error(`[DNS-FIX] DoH failed for ${hostname}:`, dohErr ? dohErr.message : "no IP returned");
    
    // 2) Fall back to system DNS if DoH fails
    origLookup.call(dns, hostname, options, callback);
  });
};
