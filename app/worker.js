const STATIC = "static";
const RESOURCES = "resources";

self.addEventListener("install", (event) =>
    event.waitUntil(
        Promise.all([
            self.skipWaiting(),
            caches.delete(STATIC),
            caches.delete(RESOURCES),
        ]).then(() => caches.open(STATIC)).then((cache) =>
            cache.add(
                "./main.js",
            )
        ),
    ));

self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

self.addEventListener("sync", (event) =>
    event.waitUntil(
        Promise.all([
            clients.claim(),
            caches.delete(RESOURCES),
        ]),
    ));

self.addEventListener("message", (event) =>
    event.waitUntil([
        clients.claim(),
        caches.delete(RESOURCES),
    ]));

const base64Fixer = (c) => c.charCodeAt(0);

const utf8base64ToUint8Array = (payload) => {
    const brokenPayload = atob(payload);
    return Uint8Array.from(brokenPayload, base64Fixer);
};

const responseFromBuffer = (
    buffer,
    contentType,
    etag,
) => {
    const headers = new Headers({
        "Content-Length": buffer.length.toString(),
        "Content-Type": contentType,
    });
    if (etag) {
        headers.append("ETag", etag);
    }
    return new Response(buffer, { status: 200, headers });
};

const createResponseFromAttachment = (
    {
        data,
        contentType = "application/javascript",
    },
    etag,
) => responseFromBuffer(utf8base64ToUint8Array(data), contentType, etag);

const ongoingLoads = new Map();

const handleEntryRequest = async (event) => {
    const cache = await caches.open(RESOURCES);
    const base = event.request.url.substring(
        event.request.url.indexOf("/entries/"),
    );
    const nextSeparator = base.indexOf("/", 9);
    const nextDot = base.indexOf(".", 9);
    let endIndex;
    if (nextSeparator !== -1 && nextDot !== -1) {
        endIndex = Math.min(nextSeparator, nextDot);
    } else if (nextSeparator !== -1) {
        endIndex = nextSeparator;
    } else if (nextDot !== -1) {
        endIndex = nextDot;
    }

    const prematchedRequest = await cache.match(base);
    if (prematchedRequest) {
        return prematchedRequest;
    }

    const resourceFileUrl =
        `${base.substring(0, endIndex).replace("/entries/", "./resources/")}.json`;

    if (ongoingLoads.has(resourceFileUrl)) {
        await ongoingLoads.get(resourceFileUrl);
        const matchedRequest = await cache.match(base);
        if (matchedRequest) {
            return matchedRequest;
        }
    }

    let resolve;
    const promise = new Promise(res => {
        resolve = res;
    });
    ongoingLoads.set(resourceFileUrl, promise);

    const response = await fetch(
        resourceFileUrl
    );
    const data = await response.json();
    const promises = [];
    for (const requestUrl in data) {
        const contentType = requestUrl.endsWith(".css")
            ? "text/css"
            : "application/javascript";
        promises.push(cache.put(
            requestUrl,
            createResponseFromAttachment({
                data: data[requestUrl],
                contentType,
            }, response.headers.get("ETag")),
        ));
    }
    await Promise.all(promises);
    resolve();
    ongoingLoads.delete(resourceFileUrl);

    return cache.match(base).then(
        async (resp) => {
            if (resp) {
                const contentType = resp.headers.get("Content-Type");
                const timeoutPromise = new Promise((_res, rej) =>
                    setTimeout(rej, 5000)
                );
                const bufferPromise = resp.arrayBuffer();
                try {
                    const buffer = await Promise.race([
                        bufferPromise,
                        timeoutPromise,
                    ]);
                    return responseFromBuffer(new Uint8Array(buffer), contentType);
                } catch (_nothing) {
                    return new Response(undefined, { status: 500 });
                }
            }
            return new Response(undefined, { status: 404 });
        },
    );
};

self.addEventListener("fetch", (event) => {
    if (event.request.url.includes("/entries/")) {
        return event.respondWith(handleEntryRequest(event));
    } else if (
        event.request.url.endsWith("/main.js") ||
        event.request.url.endsWith("/index.html")
    ) {
        return event.respondWith(
            caches.open(STATIC)
                .then((cache) => cache.match(event.request))
                .then((match) => match || fetch(event.request)),
        );
    }
});
