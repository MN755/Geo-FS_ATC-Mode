export {};

declare global {
  interface Window {
    __GE0FS_ATC_BRIDGE_INSTALLED__?: boolean;
    __GEOFS_ATC_FETCH_HOOKED__?: boolean;
    __GEOFS_ATC_XHR_HOOKED__?: boolean;
    __GEOFS_ATC_VISIBILITY_HOOKED__?: boolean;
    __GEOFS_ATC_MESSAGE_HOOKED__?: boolean;
  }

  interface XMLHttpRequest {
    __geofsAtcMethod?: string;
    __geofsAtcUrl?: string;
    __geofsAtcHeaders?: Map<string, string>;
  }
}

interface BridgeEventPayload {
  type:
    | "geofs:update"
    | "geofs:map"
    | "geofs:visibility"
    | "geofs:bridge-installed"
    | "geofs:bridge-heartbeat"
    | "geofs:chat-staged"
    | "geofs:hook-error";
  requestUrl?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseStatus?: number;
  visibilityState?: DocumentVisibilityState;
  timestamp: number;
}

// This is injected as a classic script: keep every runtime binding off the host global scope.
(() => {
  let pendingChatMessage = "";
  let wrappedFetch: typeof window.fetch | null = null;
  let wrappedXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  let wrappedXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  let wrappedXhrSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;

  const emit = (event: BridgeEventPayload): void => {
    window.postMessage(
      {
        source: "geofs-atc-bridge",
        event
      },
      "*"
    );
  };

  const cloneJsonBody = async (body: Response | Request): Promise<unknown> => {
    try {
      if ("clone" in body) {
        return await body.clone().json();
      }
    } catch {
      return null;
    }

    return null;
  };

  const parseRequestLikeBody = (body: unknown): unknown => {
    if (typeof body !== "string") {
      return body ?? null;
    }

    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  };

  const injectPendingChatIntoBody = (body: unknown): { nextBody: unknown; serializedBody: string | null } | null => {
    if (!pendingChatMessage) {
      return null;
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const nextBody = {
      ...(body as Record<string, unknown>),
      m: pendingChatMessage
    };
    pendingChatMessage = "";

    return {
      nextBody,
      serializedBody: JSON.stringify(nextBody)
    };
  };

  const installFetchHook = (): void => {
    if (wrappedFetch && window.fetch === wrappedFetch) {
      window.__GEOFS_ATC_FETCH_HOOKED__ = true;
      return;
    }

    const nativeFetch = window.fetch.bind(window);
    wrappedFetch = async (input, init) => {
      const request = new Request(input, init);
      const url = request.url;

      if (url.includes("mps.geo-fs.com/update")) {
        const requestBody = (await cloneJsonBody(request)) ?? {};
        if (pendingChatMessage) {
          const injected = injectPendingChatIntoBody(requestBody);
          if (injected) {
            emit({
              type: "geofs:chat-staged",
              requestUrl: url,
              requestBody: injected.nextBody,
              timestamp: Date.now()
            });
            init = {
              ...init,
              body: injected.serializedBody,
              headers: {
                "content-type": "application/json",
                ...(init?.headers ?? {})
              }
            };
          } else {
            emit({
              type: "geofs:hook-error",
              requestUrl: url,
              requestBody,
              timestamp: Date.now()
            });
          }
        }

        const response = await nativeFetch(input, init);
        emit({
          type: "geofs:update",
          requestUrl: url,
          requestBody,
          responseStatus: response.status,
          responseBody: await cloneJsonBody(response),
          timestamp: Date.now()
        });
        return response;
      }

      if (url.includes("mps.geo-fs.com/map")) {
        const response = await nativeFetch(input, init);
        emit({
          type: "geofs:map",
          requestUrl: url,
          requestBody: await cloneJsonBody(request),
          responseStatus: response.status,
          responseBody: await cloneJsonBody(response),
          timestamp: Date.now()
        });
        return response;
      }

      return nativeFetch(input, init);
    };
    window.fetch = wrappedFetch;
    window.__GEOFS_ATC_FETCH_HOOKED__ = true;
  };

  const installXhrHook = (): void => {
    if (
      wrappedXhrOpen &&
      wrappedXhrSend &&
      wrappedXhrSetRequestHeader &&
      XMLHttpRequest.prototype.open === wrappedXhrOpen &&
      XMLHttpRequest.prototype.send === wrappedXhrSend &&
      XMLHttpRequest.prototype.setRequestHeader === wrappedXhrSetRequestHeader
    ) {
      window.__GEOFS_ATC_XHR_HOOKED__ = true;
      return;
    }

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    wrappedXhrOpen = function open(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      this.__geofsAtcMethod = method;
      this.__geofsAtcUrl = String(url);
      this.__geofsAtcHeaders = new Map<string, string>();
      return Reflect.apply(nativeOpen, this, [method, url, ...rest] as Parameters<typeof nativeOpen>);
    };

    wrappedXhrSetRequestHeader = function setRequestHeader(this: XMLHttpRequest, name: string, value: string) {
      this.__geofsAtcHeaders?.set(name.toLowerCase(), value);
      return nativeSetRequestHeader.call(this, name, value);
    };

    wrappedXhrSend = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const url = this.__geofsAtcUrl ?? "";
      const parsedBody = parseRequestLikeBody(body);
      let nextBody = body ?? null;

      if (url.includes("mps.geo-fs.com/update") && pendingChatMessage) {
        const injected = injectPendingChatIntoBody(parsedBody);
        if (injected) {
          nextBody = injected.serializedBody;
          if (!this.__geofsAtcHeaders?.has("content-type")) {
            nativeSetRequestHeader.call(this, "content-type", "application/json");
          }
          emit({
            type: "geofs:chat-staged",
            requestUrl: url,
            requestBody: injected.nextBody,
            timestamp: Date.now()
          });
        } else {
          emit({
            type: "geofs:hook-error",
            requestUrl: url,
            requestBody: parsedBody,
            timestamp: Date.now()
          });
        }
      }

      if (url.includes("mps.geo-fs.com/update") || url.includes("mps.geo-fs.com/map")) {
        this.addEventListener(
          "loadend",
          () => {
            const eventType = url.includes("mps.geo-fs.com/update") ? "geofs:update" : "geofs:map";
            emit({
              type: eventType,
              requestUrl: url,
              requestBody: parseRequestLikeBody(nextBody),
              responseStatus: this.status,
              responseBody: parseRequestLikeBody(this.responseText),
              timestamp: Date.now()
            });
          },
          { once: true }
        );
      }

      return nativeSend.call(this, nextBody);
    };

    XMLHttpRequest.prototype.open = wrappedXhrOpen;
    XMLHttpRequest.prototype.setRequestHeader = wrappedXhrSetRequestHeader;
    XMLHttpRequest.prototype.send = wrappedXhrSend;
    window.__GEOFS_ATC_XHR_HOOKED__ = true;
  };

  const ensureHooksInstalled = (): void => {
    installFetchHook();
    installXhrHook();
  };

  const installVisibilityHook = (): void => {
    if (window.__GEOFS_ATC_VISIBILITY_HOOKED__) {
      return;
    }

    window.__GEOFS_ATC_VISIBILITY_HOOKED__ = true;
    const emitVisibility = () =>
      emit({
        type: "geofs:visibility",
        visibilityState: document.visibilityState,
        timestamp: Date.now()
      });

    document.addEventListener("visibilitychange", emitVisibility);
    emitVisibility();
  };

  const installMessageListener = (): void => {
    if (window.__GEOFS_ATC_MESSAGE_HOOKED__) {
      return;
    }

    window.__GEOFS_ATC_MESSAGE_HOOKED__ = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || !event.data || event.data.source !== "geofs-atc-content") {
        return;
      }

      if (event.data.type === "page/send-chat" && typeof event.data.payload?.message === "string") {
        pendingChatMessage = event.data.payload.message;
      }
    });
  };

  const installBridge = (): void => {
    if (window.__GE0FS_ATC_BRIDGE_INSTALLED__) {
      return;
    }

    window.__GE0FS_ATC_BRIDGE_INSTALLED__ = true;
    ensureHooksInstalled();
    installVisibilityHook();
    installMessageListener();
    emit({
      type: "geofs:bridge-installed",
      timestamp: Date.now()
    });
    window.setInterval(() => {
      ensureHooksInstalled();
      emit({
        type: "geofs:bridge-heartbeat",
        timestamp: Date.now()
      });
    }, 4_000);
  };

  installBridge();
})();
