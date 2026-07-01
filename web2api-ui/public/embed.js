/*
 * Lumina embeddable chat widget loader.
 * Usage on any allowed site:
 *   <script src="https://YOUR-APP/embed.js" data-embed="emb_xxx" data-token-key="auth_token" async></script>
 *
 * Optionally provide the token explicitly:
 *   <script>window.LuminaEmbed = { token: "<sanctum token>" };</script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  // Resolve config from the <script> tag
  var EMBED_KEY = script.getAttribute("data-embed");
  var TOKEN_KEY = script.getAttribute("data-token-key") || "auth_token";
  var POSITION = script.getAttribute("data-position") || "bottom-right";
  if (!EMBED_KEY) {
    console.error("[LuminaEmbed] missing data-embed attribute");
    return;
  }

  // The widget app origin = where this script was served from
  var BASE = new URL(script.src).origin;

  // Idempotent — don't inject twice
  if (window.__luminaEmbedLoaded) return;
  window.__luminaEmbedLoaded = true;

  function resolveToken() {
    if (window.LuminaEmbed && window.LuminaEmbed.token) return window.LuminaEmbed.token;
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  // --- Build a style-isolated host (Shadow DOM) ---------------------------
  var host = document.createElement("div");
  host.id = "lumina-embed-host";
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var side = POSITION === "bottom-left" ? "left: 20px;" : "right: 20px;";
  var style = document.createElement("style");
  style.textContent =
    ".lumina-bubble{position:fixed;bottom:20px;" + side +
    "width:56px;height:56px;border-radius:50%;background:#7c3aed;color:#fff;border:none;" +
    "cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2147483646;display:flex;" +
    "align-items:center;justify-content:center;font-size:24px;}" +
    ".lumina-frame{position:fixed;bottom:88px;" + side +
    "width:380px;height:560px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);" +
    "border:none;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.35);z-index:2147483646;" +
    "background:#0a0a0a;display:none;}" +
    ".lumina-frame.open{display:block;}";
  root.appendChild(style);

  var bubble = document.createElement("button");
  bubble.className = "lumina-bubble";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.textContent = "💬";
  root.appendChild(bubble);

  var iframe = document.createElement("iframe");
  iframe.className = "lumina-frame";
  iframe.setAttribute(
    "sandbox",
    "allow-scripts allow-forms allow-popups allow-same-origin"
  );
  iframe.src = BASE + "/widget?embed=" + encodeURIComponent(EMBED_KEY);
  root.appendChild(iframe);

  var opened = false;
  function toggle() {
    opened = !opened;
    iframe.classList.toggle("open", opened);
    bubble.textContent = opened ? "✕" : "💬";
  }
  bubble.addEventListener("click", toggle);

  // --- Hand the token to the iframe when it signals ready -----------------
  window.addEventListener("message", function (e) {
    if (e.origin !== BASE) return; // only trust our widget origin
    if (e.data && e.data.type === "ready") {
      iframe.contentWindow.postMessage(
        { type: "lumina-auth", token: resolveToken() },
        BASE
      );
    } else if (e.data && e.data.type === "lumina-close") {
      if (opened) toggle();
    } else if (e.data && e.data.type === "lumina-resize" && e.data.height) {
      iframe.style.height = Math.min(e.data.height, window.innerHeight - 120) + "px";
    }
  });
})();
