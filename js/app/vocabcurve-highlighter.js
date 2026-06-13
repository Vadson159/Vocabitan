/**
 * VocabCurve Highlighter — highlights dictionary words on web pages.
 * Activated by holding Shift. Reads highlight mode from chrome.storage.local.
 * Fetches the word lists from the local VocabCurve backend.
 */
class VocabCurveHighlighter {
    constructor() {
        this._isActive = false;
        this._cache = null;
        this._lastFetchTime = 0;
        this._currentLang = null;

        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundKeyUp = this._onKeyUp.bind(this);
        this._boundBlur = () => this._deactivate();

        window.addEventListener('keydown', this._boundKeyDown);
        window.addEventListener('keyup', this._boundKeyUp);
        window.addEventListener('blur', this._boundBlur);

        this._injectStyles();
    }

    // ---- Styles ----

    _injectStyles() {
        if (document.getElementById('vc-highlighter-styles')) return;
        const style = document.createElement('style');
        style.id = 'vc-highlighter-styles';
        // ::highlight() only supports: background-color, color, text-decoration, text-shadow
        style.textContent = `
            ::highlight(vc-tracked-highlight) {
                background-color: rgba(255, 165, 0, 0.35);
                text-decoration: underline wavy rgba(255, 165, 0, 0.8);
            }
            ::highlight(vc-known-highlight) {
                background-color: rgba(76, 175, 80, 0.3);
                text-decoration: underline solid rgba(76, 175, 80, 0.8);
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ---- Settings helpers ----

    /**
     * Get the SOURCE language (the one being studied) from Yomitan's options
     * via chrome.runtime.sendMessage to the background script.
     */
    async _getSourceLanguage() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(
                    {action: 'optionsGet', params: {optionsContext: {current: true}}},
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('[VocabCurve Highlighter] Could not get options:', chrome.runtime.lastError.message);
                            resolve('es');
                            return;
                        }
                        if (response && response.general && response.general.language) {
                            resolve(response.general.language); // e.g. 'es', 'de', 'pl'
                        } else {
                            resolve('es');
                        }
                    },
                );
            } catch (e) {
                resolve('es');
            }
        });
    }

    /** @returns {Promise<string>} 'none' | 'tracked' | 'known' | 'all' */
    async _getHighlightMode() {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get(['vocabcurve_highlight_mode'], (res) => {
                    if (chrome.runtime.lastError) {
                        resolve('none');
                        return;
                    }
                    resolve(res.vocabcurve_highlight_mode || 'none');
                });
            } catch (e) {
                resolve('none');
            }
        });
    }

    // ---- Highlight lifecycle ----

    _clearHighlights() {
        try {
            if (typeof CSS !== 'undefined' && CSS.highlights) {
                CSS.highlights.delete('vc-tracked-highlight');
                CSS.highlights.delete('vc-known-highlight');
            }
        } catch (e) { /* Silently ignore if API not supported */ }
    }

    _deactivate() {
        this._isActive = false;
        this._clearHighlights();
    }

    async _onKeyDown(e) {
        if (e.key !== 'Shift') return;
        if (this._isActive) return;
        this._isActive = true;

        // Check if feature is enabled
        const mode = await this._getHighlightMode();
        if (mode === 'none') {
            this._isActive = false;
            return;
        }

        // Get the language being studied from Yomitan profile
        const lang = await this._getSourceLanguage();

        // Fetch word lists from backend via background script (to avoid PNA prompts on Edge/Chrome)
        const needsFetch = !this._cache || Date.now() - this._lastFetchTime > 5000 || this._currentLang !== lang;
        if (needsFetch) {
            try {
                const fetchResult = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({action: 'vocabCurveFetchWords', lang}, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(response);
                        }
                    });
                });
                if (fetchResult && fetchResult.success) {
                    this._cache = fetchResult.data;
                    this._lastFetchTime = Date.now();
                    this._currentLang = lang;
                } else {
                    this._isActive = false;
                    return;
                }
            } catch (err) {
                this._isActive = false;
                return;
            }
        }

        if (!this._cache || this._cache.status !== 'success') {
            this._isActive = false;
            return;
        }

        // Bail out if user already released Shift during the async work
        if (!this._isActive) return;

        this._applyHighlights(mode);
    }

    _onKeyUp(e) {
        if (e.key === 'Shift') {
            this._deactivate();
        }
    }

    // ---- Core highlighting ----

    _applyHighlights(mode) {
        if (typeof CSS === 'undefined' || !CSS.highlights) {
            console.warn('[VocabCurve Highlighter] CSS Custom Highlight API not supported in this browser.');
            return;
        }

        const tracked = this._cache.trackedWords || [];
        const known = this._cache.knownWords || [];

        const setTracked = new Set();
        const setKnown = new Set();

        if (mode === 'tracked' || mode === 'all') {
            for (const w of tracked) setTracked.add(w.toLowerCase());
        }
        if (mode === 'known' || mode === 'all') {
            for (const w of known) setKnown.add(w.toLowerCase());
        }

        if (setTracked.size === 0 && setKnown.size === 0) return;

        const rangesTracked = [];
        const rangesKnown = [];

        // Unicode-aware word regex: \p{L} matches any letter, \p{M} marks
        const wordRegex = /[\p{L}\p{M}'-]+/gu;

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    // Skip script/style/noscript contents
                    const tag = node.parentElement?.tagName;
                    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                },
            },
        );

        let textNode;
        while ((textNode = walker.nextNode())) {
            const text = textNode.nodeValue;
            if (!text || text.trim().length === 0) continue;

            wordRegex.lastIndex = 0;
            let match;
            while ((match = wordRegex.exec(text)) !== null) {
                const word = match[0].toLowerCase();

                const isTracked = setTracked.has(word);
                const isKnown = setKnown.has(word);

                if (isTracked || isKnown) {
                    try {
                        const range = new Range();
                        range.setStart(textNode, match.index);
                        range.setEnd(textNode, match.index + match[0].length);
                        if (isTracked) {
                            rangesTracked.push(range);
                        } else {
                            rangesKnown.push(range);
                        }
                    } catch (rangeErr) {
                        // Range creation can fail on detached nodes, skip silently
                    }
                }
            }
        }

        // Apply highlights
        this._clearHighlights();

        if (rangesTracked.length > 0) {
            CSS.highlights.set('vc-tracked-highlight', new Highlight(...rangesTracked));
        }
        if (rangesKnown.length > 0) {
            CSS.highlights.set('vc-known-highlight', new Highlight(...rangesKnown));
        }

        console.log(`[VocabCurve Highlighter] Highlighted ${rangesTracked.length} tracked + ${rangesKnown.length} known words.`);
    }
}

// Boot
try {
    const _vcHighlighter = new VocabCurveHighlighter();
} catch (e) {
    console.warn('[VocabCurve Highlighter] Failed to initialize:', e);
}
