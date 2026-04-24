"use strict";
console.error("[DNS-FIX] Loaded — DoH resolver + tls/net logging active.");
const http = require("http");
const https = require("https");
const { PassThrough } = require("stream");

const blockedDomains = ["api.telegram.org", "discord.com", "discordapp.com", "web.whatsapp.com"];

function isBlocked(hostname) {
  return hostname && blockedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

// Monkey-patch http.request and https.request
const _origHttpRequest = http.request;
const _origHttpsRequest = https.request;

// Robust fetch-like wrapper using original (unpatched) http/https modules
function originalRequest(protocol, url, options, body) {
  const parsedUrl = new URL(url);
  const origFn = protocol === "https:" ? _origHttpsRequest : _origHttpRequest;
  
  return new Promise((resolve, reject) => {
    const req = origFn(parsedUrl, options, (res) => {
      resolve(res);
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function transparentProxyRequest(protocol, origFn, ...args) {
  let options = args[0];
  let callback = args[1];

  if (typeof options === "string") {
    try {
      options = new URL(options);
    } catch {
      return origFn.apply(this, args);
    }
  } else if (options instanceof URL) {
    // Already a URL
  } else {
    // Object options
    options = { ...options };
  }

  // RECURSION GUARD: Check for a custom property we'll set
  if (options && options.__isProxyRequest) {
    return origFn.apply(this, args);
  }

  if (typeof callback !== "function" && typeof args[2] === "function") {
    callback = args[2];
  }

  const hostname = options.hostname || options.host;
  const path = options.path || options.pathname || "/";

  if (isBlocked(hostname)) {
    console.error(`[DNS-FIX] Transparently proxying ${protocol}//${hostname}${path}`);

    const requestUrl = `${protocol}//${hostname}${path}`;
    const requestHeaders = { ...options.headers };
    
    const reqStream = new PassThrough();
    
    let requestBody = Buffer.alloc(0);
    reqStream.on("data", (chunk) => {
      requestBody = Buffer.concat([requestBody, chunk]);
    });

    reqStream.on("finish", async () => {
      try {
        const fetchRes = await originalRequest(protocol, requestUrl, {
          method: options.method || "GET",
          headers: requestHeaders,
          __isProxyRequest: true, // Internal flag to prevent recursion
        }, options.method !== "GET" && options.method !== "HEAD" ? requestBody : undefined);

        if (callback) callback(fetchRes);
        reqStream.emit("response", fetchRes);
        // fetchRes is already an IncomingMessage (readable stream)
      } catch (err) {
        console.error(`[DNS-FIX] Proxy error for ${requestUrl}: ${err.message}`);
        reqStream.emit("error", err);
      }
    });

    // Mock ClientRequest methods
    reqStream.abort = () => reqStream.destroy();
    reqStream.end = (chunk) => {
      if (chunk) reqStream.write(chunk);
      reqStream.end();
    };
    reqStream.setTimeout = (ms, cb) => { if (cb) setTimeout(cb, ms); return reqStream; };
    reqStream.setNoDelay = () => reqStream;
    reqStream.setSocketKeepAlive = () => reqStream;

    return reqStream;
  }

  return origFn.apply(this, args);
}

http.request = function (...args) {
  return transparentProxyRequest("http:", _origHttpRequest, ...args);
};

https.request = function (...args) {
  return transparentProxyRequest("https:", _origHttpsRequest, ...args);
};

http.get = function (...args) {
  const req = http.request(...args);
  req.end();
  return req;
};

https.get = function (...args) {
  const req = https.request(...args);
  req.end();
  return req;
};
