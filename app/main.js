// Basics

const jQuery = function (el) {
    return new jQuery(el);
}

const assignIn = (child, parent) => {
    for (const ownOrInheritedKey in parent) {
        child[ownOrInheritedKey] = parent[ownOrInheritedKey];
    }
};

window.providedData = class ProvidedData { 
    static extend(protoProps) {
        const parent = this;
        let child;

        if (protoProps && protoProps.hasOwnProperty(constructor)) {
            child = protoProps.constructor;

            const Surrogate = function () {
                this.constructor = child;
            };
            Surrogate.prototype = parent.prototype;
            child.prototype = new Surrogate();

            child.__super__ = parent.prototype;
        } else {
            child = class extends parent { };
        }

        if (protoProps) {
            assignIn(child.prototype, protoProps);
        }

        return child;
    }
};
window.$ = jQuery;

// Dynamic imports without CSP violations, see https://bugs.chromium.org/p/chromium/issues/detail?id=979351
const load = url => new Promise((res, rej) => {
    const script = document.createElement("script");
    script.url = url;
    script.type = "module";
    document.head.appendChild(script);
    const timeoutId = setTimeout(() => {
        script.remove();
        rej(new Error("timeout"));
    }, 10000);
    import(url).then(module => {
        clearTimeout(timeoutId);
        script.remove();
        res(module);
    }).catch(err => {
        script.remove();
        rej(err);
    });
});

// Dynamic style imports
const STYLE_IMPORTER_SELECTOR = "#import-sheet";

let importSheet;

const importedStylesheets = new Set();
const loadingStylesheets = new Map();

const getRuleForUrl = (stylesheetUrl) =>
    `@import url("${stylesheetUrl}");`;

const commitStylesheet = (stylesheetUrl) => {
    importSheet.insertRule(getRuleForUrl(stylesheetUrl));
    importedStylesheets.add(stylesheetUrl);
    return new Promise(res => {
        const timeoutId = setTimeout(() => revertStylesheet(stylesheetUrl), 10000);
        loadingStylesheets.set(stylesheetUrl, () => {
            clearTimeout(timeoutId);
            loadingStylesheets.delete(stylesheetUrl);
            res();
        });
    });
};

const resolveImportPromise = () => {
    if (loadingStylesheets.size === 0) {
        return;
    }
    const importedStylesheetUrls = Array.from(importSheet.cssRules).filter(
        (cssRule) =>
            cssRule instanceof CSSImportRule &&
            loadingStylesheets.has(cssRule.href) &&
            cssRule.styleSheet instanceof CSSStyleSheet
    );
    for (const cssRule of importedStylesheetUrls) {
        try {
            // The cssRules access should throw an error if the stylesheet load
            // has failed. Otherwise the access should work without issue.
            cssRule.styleSheet.cssRules;
        } catch (_err) {
            // Even on import error simply resolve the Promise: A stylesheet load
            // failure is not worthy of a throw.
            throw new Error("timeout");
        }
        const resolveFunction = loadingStylesheets.get(cssRule.href);
        resolveFunction();
    }
};

const revertStylesheet = (stylesheetUrl) => {
    if (loadingStylesheets.has(stylesheetUrl)) {
        // Resolve the loading promise
        loadingStylesheets.get(stylesheetUrl)();
    }
    try {
        const ruleString = getRuleForUrl(stylesheetUrl);
        const deleteIndex = Array.prototype.findIndex.call(
            importSheet.rules,
            (rule) => rule.cssText === ruleString
        );
        if (deleteIndex !== -1) {
            importSheet.deleteRule(deleteIndex);
            return importedStylesheets.delete(stylesheetUrl);
        }
        return false;
    } catch (err) {
        console.log("Failed to revert stylesheet import", err);
        return false;
    }
};

const tryGetImportSheet = () => {
    if (importSheet) {
        return true;
    }
    const importStyleElement = document.querySelector(STYLE_IMPORTER_SELECTOR);
    if (importStyleElement) {
        for (const stylesheet of document.styleSheets) {
            if (stylesheet.ownerNode === importStyleElement) {
                importSheet = stylesheet;
                importStyleElement.addEventListener(
                    "load",
                    resolveImportPromise,
                    { passive: true }
                );
                importStyleElement.addEventListener(
                    "error",
                    resolveImportPromise,
                    { passive: true }
                );
                return true;
            }
        }
    }
    return false;
};

const addStylesheet = (stylesheetUrl) => {
    if (importedStylesheets.has(stylesheetUrl)) {
        return Promise.resolve();
    } else if (loadingStylesheets.has(stylesheetUrl)) {
        // Daisy-chain into the original resolve function.
        const originalResolve = loadingStylesheets.get(stylesheetUrl);
        return new Promise(res => {
            loadingStylesheets.set(stylesheetUrl, () => {
                originalResolve();
                res();
            });
        });
    }
    if (tryGetImportSheet()) {
        return commitStylesheet(stylesheetUrl);
    } else {
        // Couldn't find import sheet
        return Promise.reject(
            new TypeError(
                "Invalid style-importer usage, import stylesheet not detected"
            )
        );
    }
};

window.addStylesheet = addStylesheet;

// Main
const main = async () => {
    const registration = await navigator.serviceWorker.register("./worker.js");
    await navigator.serviceWorker.ready;
    await registration.sync.register("sync");

    const loadButton = document.querySelector(".load-button");
    loadButton.addEventListener("click", async () => {
        const { default: { data, stylesheets } } = await load("/entries/bar.js").catch(err => {
            const errordiv = document.createElement("div");
            errordiv.textContent = "ERROR OCCURRED: " + err.message;
            document.body.appendChild(errordiv);
            throw err;
        });
        const promises = stylesheets.map(addStylesheet);
        await Promise.all(promises);
        const { default: { data: data2 }} = await load("/entries/myProvidedData.js");
    
        const dataEl = document.createElement("div");
        dataEl.className = "load-result";
        dataEl.textContent = `
        ${data.toString()}
        ${stylesheets}
        ${data2.toString()}`;
        document.body.appendChild(dataEl);
    });
}

main();