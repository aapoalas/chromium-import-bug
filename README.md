## Demo for Chrome stalling requests when results arrive in surprising order

This repository contains a demo of an apparent bug in Google Chrome (Chromium not verified) related to importing of an ECMASCript module with a large web of dependencies, sometimes interconnecting, hidden behind it.
Importing such a file should cause Chrome no issues, it should simply download all dependencies, scan them for more dependencies and keep loading until no more are found. After that the module should being executing.

What happens instead is that sometimes (1-2 times for every 3 reloads for me personally) one or more of the dependency requests will stall and never resolve. This leads to the main import never resolving and a broken, forever pending Promise is born. In the demo a manual timeout of 10 seconds is applied to reject the load promise in this case but that doesn't help; Chrome still keeps the request pending forever and ever.

### Usage

1. Checkout the repository.
2. Use your favourite file server to serve the /app directory.
3. Open the served application in Chrome (try other browsers to see if results change).
4. Press the "LOAD DATA" button.
5. If a red box appears, the load went smoothly. Reload.
6. If nothing appears for a time, wait until a message "ERROR OCCURRED: timeout" appears. The bug reproduced. Check the requests' Timing data on DevTools' Network tab. You'll find at least one request that looks like it is 100% finished and done but the Timing tab for the request shows a message: "CAUTION: the request is not finished yet!".
7. Report results to me.

## How does it work

So, you probably have questions about how the application is built.

### main.js

Your everyday main JavaScript file. There are a few items provided into the window object (in the real application my ESquireJS library's `provide()` function is used, do check it out), mainly jQuery and `class ProvidedData` which you may notice is a barebones Backbone object (extend function shamelessly copied).

After that comes the `load` function which is copied over (with some changes) from my ESquireJS library. This function is used instead of directly using `import()` to avoid another Chromium bug.

After that comes a bunch of code related to stylesheet importing. This is an attempt of mine to implement something similar to ES module imports but for CSS modules, at the same time without going through adding a ton of `<style>` elements into the document head. This is also exposed through the window object here.

Finally at the bottom is the actual application logic. Nothing special here, register a ServiceWorker and add an event listener so that when the button is clicked a single asset is loaded. Do some style importing based on that asset's exported data and finally append some stuff to the DOM. If an error occurs (timeout), append different stuff to the DOM.

### worker.js

Not necessarily your everyday ServiceWorker. On install skip waiting, do basic cache busting and cache the static files. On activation claim clients. When sync is called (on every page load), bust the cache to make the bug repeatable. (Comment out the sync call from main.js / cache.delete from worker.js to show that the error doesn't appear if data is ready in the cache when import is done.)

The fun stuff is at the bottom. When a request to `/entries/` is detected, we respond with `handleEntryRequest()`. Here we divine the "base name" of the entry that is being looked for, eg. `/entries/bar.js` => `bar`, `/entries/foo/module/Foo.js` => `foo`. We then fetch the corresponding resource, eg. `bar` => `/resources/bar.json` and read the JSON data in it. The JSON is an object and the keys are the `/entries/...` resources that we should provide to the app. Each of these keys is accessed and the value behind the key (a base64 string) is turned into a Uint8Array with a UTF-8 sensitive handling (plain atob would cause errors in some cases). This Uint8Array is then turned into a Response object and placed into cache. After the caching is done, we respond to the original request from cache or give a 404 if nothing is found.

## /resources

These files are JSON blobs containing ECMAScript modules in base64 encoding. The 3rd party libraries (lodash, d3, Rx, ...) are the actual libraries built into ES modules using Rollup.js and are contained here for accuracy. The other source files are a "dummy" version of the real application's case with all of the meaningful names removed. Additionally, because the bug wouldn't reproduce with just the dummy versions of the files, these files contain a garbage string at the end to make the files weigh as much as the original files did.

## Questions

So, you probably now have the question of "why is the application built like this?!" Well, that's pretty much because this is the way it needs to be done. Everything has a reason, more or less. If you find something that is obviously inefficient / stupid and should be done better, do let me know.

The questions / suggestions I anticipate I will answer here.

### 1. Why the `<script type="module">` tag instead of `import()`? Maybe that causes the bug?

This way of doing dynamic imports is used because of another Chromium bug that I've reported 1.5 years ago: https://bugs.chromium.org/p/chromium/issues/detail?id=979351

In short, 'strict-dynamic' CSP is not taken into account for `import()` calls correctly but it is for `<script type="module">` imports. The actual import in both of these cases should, however, be the same: An ECMAScript module gets imported. Using the script tag to start the import allows me to sidestep CSP violations occurring and after the script tag is done loading the ES module with its exports is available through `import()` just as one would expect.

I have, of course, tried if the stalled request bug would not appear with direct `import()` calls. It does. It also appears if I use `<link type="modulepreload">` tags instead of script tags to start the loading. The bug doesn't seem to be related to import method.

### 2. Why load resources as base64 in JSON bundles? Do you not know about Webpack / Rollup / ...?

Because this is pretty much how this needs to be done. The true app where I found this bug has dynamic resources coming from a server, with an API that returns stuff roughly equivalent to what you see in the /resources folder. Each "resource" (eg. "foo") responds with a JSON resource that contains metadata (not included in this repository for obvious reasons) and source files encoded as base64.

The source files are loaded by the application on-demand and the demands can be very free indeed. eg. It is acceptable that a source file for `/entries/bar/main.js` requests `/entries/foo/module/someModule.js` but never ever requests `/entries/foo/main.js` (which does exist, it's just not included in this repository as it wasn't used in the bug). Any attempts at compiling the source files contained in a single resource file into bundle would be between useless and harmful. An export file would be needed for each source file to re-export that source files' exports from the bundled file, leading to a situation where each resource file corresponded with N + 1 served files (one for every original source file + the compiled module), essentially adding a single module in addition to forcing any code accessing some part of a resource to download all the data of the resource.

The true application is VERY dynamic. The loading logic must reply in kind.