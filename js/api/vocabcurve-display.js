export class VocabCurveDisplay {
    /**
     * @param {import('../display/display.js').Display} display
     */
    constructor(display) {
        this._display = display;
        // Map NLLB codes to simple 2-letter codes that the backend TTS/translator understand
        this._nllbToSimple = {
            'eng_Latn': 'en',
            'spa_Latn': 'es',
            'deu_Latn': 'de',
            'rus_Cyrl': 'ru',
            'pol_Latn': 'pl',
            'fra_Latn': 'fr',
            'jpn_Jpan': 'ja',
        };
        // Reverse map for guessing NLLB code from Yomitan 2-letter language
        this._yomitanToNllb = {
            'ja': 'jpn_Jpan',
            'es': 'spa_Latn',
            'ru': 'rus_Cyrl',
            'de': 'deu_Latn',
            'pl': 'pol_Latn',
            'fr': 'fra_Latn',
            'en': 'eng_Latn',
        };
        this.selectedImages = {}; // Track user-selected images for terms
    }

    prepare() {
        // Use event delegation on the document with CAPTURE phase (true).
        // This ensures our listener runs BEFORE Yomitan's own listeners can call stopPropagation().
        document.addEventListener('click', (e) => {
            // Handle our dynamically injected Anki button
            const ankiBtn = e.target.closest('.vc-anki-btn');
            if (ankiBtn) {
                e.preventDefault();
                e.stopPropagation();
                console.log('[VocabCurve] Anki button clicked!');
                // Visual feedback
                ankiBtn.style.transform = 'scale(0.95)';
                setTimeout(() => { ankiBtn.style.transform = ''; }, 100);
                this._onVocabCurveAnkiExport(ankiBtn, e);
                return;
            }

            const button = e.target.closest('.action-button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            console.log('[VocabCurve] Button clicked, action:', action);
            if (action === 'search-images' || action === 'translate-context' || action === 'local-tts') {
                // Visual feedback
                button.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
                setTimeout(() => { button.style.backgroundColor = ''; }, 200);
                
                if (action === 'search-images') {
                    this._onSearchImagesClick(button, e);
                } else if (action === 'translate-context') {
                    this._onTranslateContextClick(button, e);
                } else if (action === 'local-tts') {
                    this._onLocalTTSClick(button, e);
                }
            }
        }, true); // true = useCapture

        const entriesContainer = document.getElementById('dictionary-entries');

        const injectAll = () => {
            if (entriesContainer) {
                this._injectPhraseEntry(entriesContainer);
            }
            const entries = document.querySelectorAll('.entry');
            for (const entry of entries) {
                this._injectAnkiButton(entry);
            }
        };

        // Initial scan
        injectAll();

        // MutationObserver: inject a visible Anki button into each new entry
        if (entriesContainer) {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        injectAll();
                    }
                }
            });
            observer.observe(entriesContainer, { childList: true, subtree: true });
        }

        // Listen for display content updates (catches cases with no dictionary results)
        if (this._display) {
            this._display.on('contentUpdateComplete', () => injectAll());
        }

        // Periodic fallback to ensure buttons are present (Yomitan sometimes rerenders)
        setInterval(injectAll, 1000);
    }

    _injectAnkiButton(entryNode) {
        // Don't inject twice
        if (entryNode.querySelector('.vc-anki-btn')) return;

        const headword = entryNode.querySelector('.headword');
        if (!headword) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vc-anki-btn';
        btn.title = 'Quick Add to Anki (Vocabitan)';
        btn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 4px 10px;
            margin-right: 8px;
            background: #007bff;
            border: none;
            border-radius: 4px;
            color: white;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            vertical-align: middle;
            transition: all 0.2s;
            line-height: 1;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            order: -1;
        `;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> <span>ANKI</span>`;
        
        btn.onclick = (e) => {
            e.stopPropagation(); // Double backup
        };

        // Insert at the VERY START of headword-details or headword
        const headwordDetails = headword.querySelector('.headword-details');
        if (headwordDetails) {
            headwordDetails.style.display = 'flex';
            headwordDetails.style.alignItems = 'center';
            headwordDetails.insertBefore(btn, headwordDetails.firstChild);
        } else {
            headword.appendChild(btn);
        }
    }

    /**
     * Get the source language (2-letter) that the Yomitan dictionary is configured for.
     * @returns {string}
     */
    _getSourceLangSimple() {
        try {
            // Try reading from Yomitan's options if available
            const opts = this._display?._options;
            if (opts && opts.general && opts.general.language) {
                const lang = opts.general.language;
                return lang; // already 2-letter like 'es', 'ja', 'en'
            }
        } catch (e) { /* ignore */ }
        return 'en'; // fallback
    }

    _getHeadwordInfo(button) {
        // Try to find the closest .headword first, then fall back to .entry
        const headwordNode = button.closest('.headword');
        const entry = button.closest('.entry');
        
        if (!headwordNode && !entry) {
            console.warn('[VocabCurve] Could not find container for button', button);
            return null;
        }

        const containerNode = headwordNode || entry;
        const entryNode = entry || headwordNode; // Both are useful as anchors

        const indexStr = entryNode.dataset.index;
        const entryIndex = parseInt(indexStr, 10);
        
        let term = '';
        if (headwordNode) {
            term = headwordNode.querySelector('.headword-term')?.textContent?.trim() || '';
        }
        // Fallback: try the first headword in the entry
        if (!term) {
            const firstHeadword = entryNode.querySelector('.headword-term');
            if (firstHeadword) {
                term = firstHeadword.textContent?.trim() || '';
            }
        }

        console.log('[VocabCurve] _getHeadwordInfo:', { entryIndex, term });
        return { entryIndex, term, entryNode, containerNode };
    }

    async _onSearchImagesClick(button, e) {
        e.preventDefault();
        e.stopPropagation();
        
        try {
            const info = this._getHeadwordInfo(button);
            if (!info || !info.term) return;

            const lang = this._getSourceLangSimple();
            this._toggleImageWidget(info.containerNode, info.term, lang);

        } catch (error) {
            console.error('[VocabCurve] Image search error:', error);
            this._showStatusOverlay('❌ Error opening widget', 3000);
        }
    }

    _showStatusOverlay(text, duration = 0, isHtml = false) {
        let overlay = document.getElementById('vocabcurve-status-toast');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'vocabcurve-status-toast';
            overlay.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:white; padding:10px 20px; border-radius:30px; z-index:10000; font-size:14px; pointer-events:auto; transition: opacity 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.4); text-align:center;';
            document.body.appendChild(overlay);
        }
        if (isHtml) {
            overlay.innerHTML = text;
        } else {
            overlay.textContent = text;
        }
        overlay.style.opacity = '1';
        
        if (duration > 0) {
            setTimeout(() => { if (overlay) overlay.style.opacity = '0'; }, duration);
        }
    }

    _toggleImageWidget(containerNode, term, lang) {
        // Look for the widget immediately after our containerNode
        let widget = containerNode.nextElementSibling;
        if (widget && widget.classList.contains('vocabcurve-image-widget')) {
            const isHidden = widget.style.display === 'none';
            widget.style.display = isHidden ? 'block' : 'none';
            return;
        }

        widget = document.createElement('div');
        widget.className = 'vocabcurve-image-widget';
        widget.style.cssText = `
            margin-top: 15px;
            margin-bottom: 10px;
            padding: 15px;
            background-color: #1a1a1a;
            border: 1px solid #333;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #d4d4d4;
            clear: both;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        widget.innerHTML = `
            <div style="font-size: 10px; font-weight: bold; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                Картинка
                <button class="voc-img-back-btn" style="display:none; margin-left: 8px; padding: 2px 6px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; cursor: pointer; font-size: 10px;">←</button>
            </div>
            
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 12px;">
                <div class="voc-img-controls" style="display:flex; flex-direction:column; gap:8px;">
                    <button class="voc-img-search-btn" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px; padding: 12px; background: transparent; border: 1px dashed rgba(255,255,255,0.2); border-radius: 8px; color: rgba(255,255,255,0.6); font-size: 14px; cursor: pointer; transition: all 0.2s;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        Найти картинку (Bing)
                    </button>
                    
                    <div style="display: flex; gap: 8px; width: 100%;">
                        <input type="text" class="voc-img-modifier" placeholder="Модификатор (напр. meme, fail, cartoon)" style="flex: 1; background: #121212; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px 12px; color: #fff; font-size: 12px; box-sizing: border-box; outline: none; transition: border-color 0.2s;">
                        <button type="button" class="voc-img-global-btn" title="Искать только введенный текст (без слова)" style="padding: 0 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: rgba(255,255,255,0.6); cursor: pointer; transition: all 0.2s; display: flex; justify-content: center; align-items: center;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                        </button>
                    </div>
                </div>

                <div class="voc-img-loading" style="display: none; justify-content: center; align-items: center; gap: 8px; color: #007bff; font-size: 14px; padding: 10px 0;">
                    <span style="display:inline-block;">⌛</span> Поиск картинок...
                </div>
                
                <div class="voc-img-results" style="display: none; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 100px; gap: 10px; max-height: 320px; overflow-y: auto; padding-right: 4px; box-sizing: border-box;"></div>
            </div>
        `;

        const btn = widget.querySelector('.voc-img-search-btn');
        const input = widget.querySelector('.voc-img-modifier');
        const globalBtn = widget.querySelector('.voc-img-global-btn');
        const controls = widget.querySelector('.voc-img-controls');
        const loading = widget.querySelector('.voc-img-loading');
        const resultsContainer = widget.querySelector('.voc-img-results');
        const backBtn = widget.querySelector('.voc-img-back-btn');

        // Load previous modifier value
        const savedModifier = localStorage.getItem('vc-img-modifier') || '';
        input.value = savedModifier;

        btn.onmouseover = () => { btn.style.borderColor = 'rgba(0,123,255,0.5)'; btn.style.color = '#007bff'; btn.style.backgroundColor = 'rgba(0,123,255,0.05)'; };
        btn.onmouseout = () => { btn.style.borderColor = 'rgba(255,255,255,0.2)'; btn.style.color = 'rgba(255,255,255,0.6)'; btn.style.backgroundColor = 'transparent'; };
        globalBtn.onmouseover = () => { globalBtn.style.borderColor = 'rgba(0,123,255,0.5)'; globalBtn.style.color = '#007bff'; globalBtn.style.backgroundColor = 'rgba(0,123,255,0.05)'; };
        globalBtn.onmouseout = () => { globalBtn.style.borderColor = 'rgba(255,255,255,0.1)'; globalBtn.style.color = 'rgba(255,255,255,0.6)'; globalBtn.style.backgroundColor = 'rgba(255,255,255,0.05)'; };
        input.onfocus = () => { input.style.borderColor = 'rgba(0,123,255,0.5)'; };
        input.onblur = () => { input.style.borderColor = 'rgba(255,255,255,0.1)'; };

        // Fix input not being typable in Yomitan
        const stopProp = (e) => e.stopPropagation();
        ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'keypress'].forEach(ev => {
            input.addEventListener(ev, stopProp);
        });

        backBtn.onclick = () => {
            controls.style.display = 'flex';
            resultsContainer.style.display = 'none';
            backBtn.style.display = 'none';
        };

        const doSearch = async (ignoreTerm = false) => {
            controls.style.display = 'none';
            loading.style.display = 'flex';
            resultsContainer.style.display = 'none';
            backBtn.style.display = 'none';
            
            const modifier = input.value.trim();
            localStorage.setItem('vc-img-modifier', modifier);
            
            const queryTerm = ignoreTerm ? modifier : (modifier ? `${term} ${modifier}` : term);

            try {
                const images = await window.vocabCurveApi.searchImages(queryTerm, lang);
                loading.style.display = 'none';
                
                if (images.length === 0) {
                    controls.style.display = 'flex';
                    this._showStatusOverlay('❌ No images found', 2000);
                    return;
                }

                backBtn.style.display = 'block';
                resultsContainer.innerHTML = '';
                resultsContainer.style.display = 'grid';
                
                for (const url of images) {
                    const imgBox = document.createElement('div');
                    imgBox.setAttribute('role', 'button');
                    imgBox.style.cssText = `
                        position: relative;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(255,255,255,0.1);
                        border-radius: 8px;
                        overflow: hidden;
                        width: 100%;
                        height: 100%;
                        padding: 0;
                        margin: 0;
                        box-sizing: border-box;
                        cursor: pointer;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        transition: all 0.2s;
                    `;
                    
                    const img = document.createElement('img');
                    img.src = url;
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s; pointer-events: none;';
                    
                    imgBox.onmouseover = () => { imgBox.style.borderColor = '#007bff'; img.style.transform = 'scale(1.1)'; };
                    imgBox.onmouseout = () => { imgBox.style.borderColor = 'rgba(255,255,255,0.1)'; img.style.transform = 'scale(1)'; };

                    imgBox.onclick = async (e) => {
                        e.stopPropagation();
                        imgBox.style.opacity = '0.5';
                        try {
                            // Store as selected for Anki export
                            this.selectedImages[term] = url;
                            console.log('[VocabCurve] Image selected for term:', term, url);

                            const res = await window.vocabCurveApi.saveImage(url, term, lang);
                            if (res.status === 'success') {
                                // Clear other borders
                                resultsContainer.querySelectorAll('div').forEach(d => d.style.border = '1px solid rgba(255,255,255,0.1)');
                                imgBox.style.border = '3px solid #4CAF50';
                                imgBox.style.opacity = '1';
                                this._showStatusOverlay('✅ Image selected!', 1500);
                            }
                        } catch (err) {
                            console.error('[VocabCurve] Failed to save/select image:', err);
                            imgBox.style.opacity = '1';
                        }
                    };
                    
                    imgBox.appendChild(img);
                    resultsContainer.appendChild(imgBox);
                }
            } catch (err) {
                loading.style.display = 'none';
                controls.style.display = 'flex';
                if (this._showStatusOverlay) this._showStatusOverlay('❌ Search error', 3000);
            }
        };

        btn.onclick = () => doSearch(false);
        globalBtn.onclick = (e) => {
            e.stopPropagation();
            if(!input.value.trim()){ 
                if(this._showStatusOverlay) this._showStatusOverlay('❌ Нужно ввести текст!', 2000); 
                return;
            }
            doSearch(true);
        };
        input.onkeydown = (e) => { 
            e.stopPropagation();
            if (e.key === 'Enter') doSearch(false); 
        };

        if (containerNode.nextSibling) {
            containerNode.parentNode.insertBefore(widget, containerNode.nextSibling);
        } else {
            containerNode.parentNode.appendChild(widget);
        }
    }

    async _onTranslateContextClick(button, e) {
        e.preventDefault();
        e.stopPropagation();

        try {
            const info = this._getHeadwordInfo(button);
            if (!info) return;

            let sentenceToTranslate = info.term;
            try {
                const state = this._display._history?.state || this._display._history?._current?.state;
                if (state && state.sentence && state.sentence.text) {
                    sentenceToTranslate = state.sentence.text.trim();
                }
            } catch (err) {}

            const srcLang = this._getSourceLangSimple();
            const tgtLangNllb = localStorage.getItem('vocabcurve_tgt_lang') || 'rus_Cyrl';
            const tgtLang = this._nllbToSimple[tgtLangNllb] || tgtLangNllb;

            this._showStatusOverlay(`⌛ Translating to ${tgtLang}...`);
            
            const res = await window.vocabCurveApi.translateSentence(sentenceToTranslate, srcLang, tgtLang);
            if (res.status === 'success') {
                this._showStatusOverlay('✅ Translated.', 1000);
                this._showTranslationOverlay(res.translation, sentenceToTranslate, tgtLang);
            } else {
                this._showStatusOverlay('❌ Translation failed', 3000);
            }
        } catch (err) {
            console.error('[VocabCurve] Translation failed:', err);
        }
    }

    _showTranslationOverlay(translation, original, lang) {
        let overlay = document.getElementById('vocabcurve-translate-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'vocabcurve-translate-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10002; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;';
        
        const content = document.createElement('div');
        content.style.cssText = 'background:var(--background-color, #fff); width:100%; max-width:400px; border-radius:8px; padding:20px; box-shadow:0 5px 20px rgba(0,0,0,0.3); position:relative;';
        
        content.innerHTML = `
            <div style="font-size:12px; opacity:0.6; margin-bottom:5px;">Original:</div>
            <div style="font-style:italic; border-left:3px solid #ccc; padding-left:10px; margin-bottom:15px;">${original}</div>
            <div style="font-size:12px; opacity:0.6; margin-bottom:5px;">Translation (${lang}):</div>
            <div style="font-size:16px; font-weight:bold; color:var(--accent-color, #007bff);">${translation}</div>
            <button style="position:absolute; top:10px; right:10px; background:none; border:none; font-size:18px; cursor:pointer;" onclick="this.closest('#vocabcurve-translate-overlay').remove()">✕</button>
        `;

        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.appendChild(content);
        document.body.appendChild(overlay);
    }

    async _onLocalTTSClick(button, e) {
        e.preventDefault();
        e.stopPropagation();

        try {
            const info = this._getHeadwordInfo(button);
            if (!info || !info.term) return;

            const srcLang = this._getSourceLangSimple();
            this._showStatusOverlay('⌛ Generating TTS...');

            try {
                let url = await window.vocabCurveApi.generateTTS(info.term, info.term, srcLang);
                
                // Absolute path fix if relative pathing on backend is still missing lang prefix
                const simpleLang = this._nllbToSimple[srcLang] || srcLang;
                if (url.includes('/userimages/') && !url.includes(`/userimages/${simpleLang}/`)) {
                    const filename = url.split('/').pop();
                    url = url.replace(filename, `${simpleLang}/${filename}`);
                }

                const audio = new Audio(url);
                await audio.play();
                this._showStatusOverlay('🔊 Playing...', 1500);
            } catch (error) {
                console.error('[VocabCurve] Local TTS failed:', error);
                this._showStatusOverlay('❌ TTS Playback failed', 2000);
            }
        } catch (error) {
            console.error('[VocabCurve] TTS error:', error);
        }
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _injectPhraseEntry(container) {
        // Don't inject twice
        if (container.querySelector('.vc-phrase-entry')) return;

        const query = this._display?.query || '';
        // Only inject for multi-word queries
        const words = query.trim().split(/\s+/);
        if (words.length < 2) return;

        const phrase = query.trim();

        const entry = document.createElement('div');
        entry.className = 'entry vc-phrase-entry';
        entry.dataset.type = 'term';
        entry.dataset.index = 'phrase';
        entry.dataset.vcPhrase = phrase;
        entry.style.borderLeft = '3px solid #ff6b35';

        entry.innerHTML = `
            <div class="entry-header">
                <div class="actions">
                    <div class="action-button-container">
                        <button type="button" class="action-button" data-action="search-images" title="Search Images">
                            <span class="action-icon icon" data-icon="magnifying-glass"></span>
                        </button>
                        <button type="button" class="action-button" data-action="translate-context" title="Translate Context">
                            <span class="action-icon icon color-icon" data-icon="translation"></span>
                        </button>
                        <button type="button" class="action-button" data-action="local-tts" title="VocabTTS">
                            <span class="action-icon icon color-icon" data-icon="speaker"></span>
                        </button>
                    </div>
                </div>
                <div class="headword-list" data-count="1">
                    <div class="headword" data-index="0">
                        <div class="headword-text-container">
                            <span class="headword-term-outer source-text">
                                <span class="headword-term">${this._escapeHtml(phrase)}</span>
                            </span>
                        </div>
                        <div class="headword-details" style="display:flex; align-items:center; gap:4px;">
                            <button type="button" class="action-button" data-action="search-images" title="Search Images">
                                <span class="action-icon icon color-icon" style="display:flex; align-items:center; justify-content:center;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                </span>
                            </button>
                            <button type="button" class="action-button" data-action="translate-context" title="Translate Context">
                                <span class="action-icon icon color-icon" style="display:flex; align-items:center; justify-content:center;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"></path><path d="M4 14l6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="M22 22l-5-10-5 10"></path><path d="M14 18h6"></path></svg>
                                </span>
                            </button>
                            <button type="button" class="action-button" data-action="local-tts" title="VocabTTS">
                                <span class="action-icon icon color-icon" style="display:flex; align-items:center; justify-content:center;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="entry-body">
                <div class="entry-body-section" style="padding: 8px 0 4px 12px;">
                    <div class="definition-tag-list tag-list" style="margin-top: 0; margin-bottom: 6px;">
                        <span class="tag" data-category="vc-phrase" style="background-color: #ff6b35; color: white; border-color: #ff6b35;">
                            <span class="tag-label"><span class="tag-label-content" style="color: white; font-weight: bold;">Фраза</span></span>
                        </span>
                    </div>
                    <div class="vc-phrase-translation-container" style="font-size: 15px; line-height: 1.4; color: var(--text-color);">
                        <span class="vc-phrase-translation-loading" style="opacity:0.5; font-style:italic;">⌛ Перевод...</span>
                        <span class="vc-phrase-translation-text" style="display:none;"></span>
                    </div>
                </div>
            </div>
        `;

        container.insertBefore(entry, container.firstChild);

        // Auto-translate the phrase
        this._autoTranslatePhrase(entry, phrase);
    }

    async _autoTranslatePhrase(entry, phrase) {
        const srcLang = this._getSourceLangSimple();
        const tgtLang = localStorage.getItem('vc-anki-target-lang') || 'ru';

        try {
            const res = await window.vocabCurveApi.translateSentence(phrase, srcLang, tgtLang);
            const loadingEl = entry.querySelector('.vc-phrase-translation-loading');
            const textEl = entry.querySelector('.vc-phrase-translation-text');

            if (loadingEl) loadingEl.style.display = 'none';
            if (textEl && res.status === 'success') {
                textEl.textContent = res.translation;
                textEl.style.display = 'inline';
                entry.dataset.vcPhraseTranslation = res.translation;
            } else if (loadingEl) {
                loadingEl.textContent = '❌ Перевод не удался';
            }
        } catch (e) {
            console.warn('[VocabCurve] Phrase auto-translation failed:', e);
            const loadingEl = entry.querySelector('.vc-phrase-translation-loading');
            if (loadingEl) loadingEl.textContent = '❌ Ошибка перевода';
        }
    }

    async _onVocabCurveAnkiExport(button, e) {
        try {
            const info = this._getHeadwordInfo(button);
            if (!info || !info.term) {
                this._showStatusOverlay('❌ No word found', 2000);
                return;
            }

            const term = info.term;
            const lang = this._getSourceLangSimple();

            // Read settings from localStorage
            const deckName = localStorage.getItem('vc-anki-deck') || 'Default';
            const modelName = localStorage.getItem('vc-anki-model') || 'Basic';

            const exportWord = true; // always on
            const exportDictionary = localStorage.getItem('vc-anki-export-dictionary') === 'true';
            const exportTranslation = localStorage.getItem('vc-anki-export-translation') === 'true';
            const exportSentence = localStorage.getItem('vc-anki-export-sentence') === 'true';
            const exportImage = localStorage.getItem('vc-anki-export-image') === 'true';
            const exportWordTTS = localStorage.getItem('vc-anki-export-word-tts') === 'true';
            const exportSentenceTTS = localStorage.getItem('vc-anki-export-sentence-tts') === 'true';

            const fieldWord = localStorage.getItem('vc-anki-field-word');
            const fieldDictionary = localStorage.getItem('vc-anki-field-dictionary');
            const fieldTranslation = localStorage.getItem('vc-anki-field-translation');
            const fieldSentence = localStorage.getItem('vc-anki-field-sentence');
            const fieldImage = localStorage.getItem('vc-anki-field-image');
            const fieldWordTTS = localStorage.getItem('vc-anki-field-word-tts');
            const fieldSentenceTTS = localStorage.getItem('vc-anki-field-sentence-tts');

            if (!fieldWord || fieldWord === '(None)') {
                this._showStatusOverlay('❌ Word field is not mapped! Please go to Vocabitan settings.', 5000);
                return;
            }

            this._showStatusOverlay('⌛ Preparing Babbel-Style Card...');

            // --- Dictionary Scraping (Full Info) ---
            let dictionaryInfoHTML = '';

            if (info.entryNode) {
                // Safely clone the entire dictionary entry to preserve grammar, rules, nested lists for ANY language
                const cloneNode = info.entryNode.cloneNode(true);
                
                // Remove the term header (the word itself is already huge on the card)
                const head = cloneNode.querySelector('.headword');
                if (head) head.remove();

                // Remove action buttons injected by Yomitan/VocabCurve
                cloneNode.querySelectorAll('.action-button-container, .vocabcurve-image-widget, button, .action-button').forEach(el => el.remove());

                dictionaryInfoHTML = cloneNode.innerHTML.trim();
            }

            // --- Gather sentence context (Aggressive fallback) ---
            let sentence = '';
            let sentenceOffset = -1;
            try {
                // Try to get from standard Yomitan history
                const s1 = this._display._history?.state?.sentence;
                const s2 = this._display._history?._current?.state?.sentence;
                const sObj = s1 || s2;
                if (sObj && sObj.text) {
                    sentence = sObj.text.trim();
                    if (typeof sObj.offset === 'number') {
                        sentenceOffset = sObj.offset;
                    }
                } else if (typeof sObj === 'string') {
                    sentence = sObj.trim(); // Just in case it's stringified
                }
            } catch (err) { /* ignore */ }

            // Fallback: search the DOM if still empty
            if (!sentence) {
                const sentenceNode = document.querySelector('.sentence');
                if (sentenceNode) sentence = sentenceNode.textContent.trim();
            }

            // --- Phrase entry: fallback sentence to phrase text if empty ---
            const isPhraseEntry = info.entryNode?.classList?.contains('vc-phrase-entry');
            if (isPhraseEntry && !sentence) {
                sentence = term;
            }

            // --- Extract the source/inflected word from the sentence using offset ---
            let sourceWord = term; // fallback to headword
            if (sentence && sentenceOffset >= 0 && sentenceOffset < sentence.length) {
                let end = sentenceOffset;
                while (end < sentence.length && !/\s/.test(sentence[end])) {
                    end++;
                }
                let extracted = sentence.substring(sentenceOffset, end);
                // Strip trailing punctuation
                extracted = extracted.replace(/[.,;:!?'"»«)}\]…—–-]+$/, '');
                if (extracted.length > 0) {
                    sourceWord = extracted;
                    console.log('[VocabCurve] Extracted source word from sentence:', sourceWord, '(headword:', term, ')');
                }
            }

            // --- Build fields ---
            const fields = {};
            fields[fieldWord] = term; // headword (dictionary form) for the Word field

            if (exportDictionary && fieldDictionary && fieldDictionary !== '(None)') {
                fields[fieldDictionary] = dictionaryInfoHTML || '';
            }

            if (exportSentence && fieldSentence && fieldSentence !== '(None)') {
                let boldSentence = sentence || '';
                if (boldSentence && sourceWord) {
                    try {
                        if (sentenceOffset >= 0 && sentenceOffset < boldSentence.length) {
                            // Precise bolding: only bold the word at the exact offset
                            const prefix = boldSentence.substring(0, sentenceOffset);
                            const actualWord = boldSentence.substring(sentenceOffset, sentenceOffset + sourceWord.length);
                            const suffix = boldSentence.substring(sentenceOffset + sourceWord.length);
                            boldSentence = prefix + '<b>' + actualWord + '</b>' + suffix;
                        } else {
                            // Fallback: only bold the FIRST occurrence to avoid cluttering common words like 'la'
                            const escapedSourceWord = sourceWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(${escapedSourceWord})`, 'i');
                            boldSentence = boldSentence.replace(regex, '<b>$1</b>');
                        }
                    } catch (e) { /* fallback to original if error */ }
                }
                fields[fieldSentence] = boldSentence;
            }

            // --- Translate the WORD (headword) for the Translation field ---
            if (exportTranslation && fieldTranslation && fieldTranslation !== '(None)') {
                this._showStatusOverlay('⌛ Translating word...');
                try {
                    const srcL = this._getSourceLangSimple();
                    const tgtL = localStorage.getItem('vc-anki-target-lang') || 'ru';
                    const res = await window.vocabCurveApi.translateSentence(term, srcL, tgtL);
                    if (res.status === 'success') {
                        fields[fieldTranslation] = res.translation;
                    }
                } catch (err) {
                    console.warn('[VocabCurve] Word translation for Anki failed:', err);
                }
            }

            // --- Translate the SENTENCE for the SentenceTranslation field ---
            const fieldSentenceTranslation = localStorage.getItem('vc-anki-field-sentence-translation');
            const exportSentenceTranslation = localStorage.getItem('vc-anki-export-sentence-translation') === 'true';
            if (exportSentenceTranslation && fieldSentenceTranslation && fieldSentenceTranslation !== '(None)' && sentence) {
                this._showStatusOverlay('⌛ Translating sentence...');
                try {
                    const srcL = this._getSourceLangSimple();
                    const tgtL = localStorage.getItem('vc-anki-target-lang') || 'ru';
                    const res = await window.vocabCurveApi.translateSentence(sentence, srcL, tgtL);
                    if (res.status === 'success') {
                        fields[fieldSentenceTranslation] = res.translation;
                    }
                } catch (err) {
                    console.warn('[VocabCurve] Sentence translation for Anki failed:', err);
                }
            }

            // --- Collect media to attach (audio/picture) ---
            const audio = [];
            const picture = [];

            // Image: respect user toggle strictly
            const exportImageBool = localStorage.getItem('vc-anki-export-image') !== 'false'; // Default to true if missing

            if (exportImageBool && fieldImage && fieldImage !== '(None)') {
                let imageUrl = this.selectedImages[term];
                
                if (!imageUrl) {
                    this._showStatusOverlay('⌛ Fetching auto-image...');
                    try {
                        const images = await window.vocabCurveApi.searchImages(term, lang);
                        if (images && images.length > 0) {
                            imageUrl = images[0];
                        }
                    } catch (err) {
                        console.warn('[VocabCurve] Auto-image fetch failed:', err);
                    }
                }

                if (imageUrl) {
                    picture.push({
                        url: imageUrl,
                        filename: `vc_${term.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.jpg`,
                        fields: [fieldImage]
                    });
                }
            }

            // Word TTS
            if (exportWordTTS && fieldWordTTS && fieldWordTTS !== '(None)') {
                this._showStatusOverlay('⌛ Word TTS...');
                try {
                    const ttsUrl = await window.vocabCurveApi.generateTTS(term, term, lang);
                    audio.push({
                        url: ttsUrl,
                        filename: `vc_word_${term.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`,
                        fields: [fieldWordTTS]
                    });
                } catch (err) {
                    console.warn('[VocabCurve] Word TTS failed:', err);
                }
            }

            // Sentence TTS
            if (exportSentenceTTS && fieldSentenceTTS && fieldSentenceTTS !== '(None)' && sentence) {
                this._showStatusOverlay('⌛ Sentence TTS...');
                try {
                    const sentTtsUrl = await window.vocabCurveApi.generateTTS(sentence, term, lang, true);
                    audio.push({
                        url: sentTtsUrl,
                        filename: `vc_sent_${term.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`,
                        fields: [fieldSentenceTTS]
                    });
                } catch (err) {
                    console.warn('[VocabCurve] Sentence TTS failed:', err);
                }
            }

            const allowDuplicate = localStorage.getItem('vc-anki-allow-duplicate') === 'true';

            // --- Send to AnkiConnect ---
            this._showStatusOverlay('⌛ Sending to Anki...');
            const noteParams = {
                note: {
                    deckName: deckName,
                    modelName: modelName,
                    fields: fields,
                    options: {
                        allowDuplicate: allowDuplicate,
                        duplicateScope: 'collection',
                    },
                    tags: ['vocabcurve'],
                }
            };
            if (audio.length > 0) noteParams.note.audio = audio;
            if (picture.length > 0) noteParams.note.picture = picture;

            console.log('[VocabCurve] Sending to Anki:', JSON.stringify(noteParams, null, 2));

            try {
                const result = await window.vocabCurveApi.sendToAnki('addNote', noteParams);
                console.log('[VocabCurve] Anki response (Note ID):', result);
                
                // Add word to VocabCurve dictionary
                try {
                    console.log('[VocabCurve] Adding to dictionary:', term, lang);
                    await window.vocabCurveApi.addWordToDictionary(term, lang);
                } catch (dictErr) {
                    console.warn('[VocabCurve] Failed to add word to dictionary:', dictErr);
                }
                
                // Show success with a View button (using <span> with button-like style to avoid navigation)
                const successMsg = `✅ Added to <b>${deckName}</b>! <span id="vc-view-anki" style="color:#4a9eff; text-decoration:underline; margin-left:12px; font-weight:bold; cursor:pointer;">[VIEW]</span>`;
                this._showStatusOverlay(successMsg, 8000, true);
                
                // Set up the View link handler
                setTimeout(() => {
                    const viewBtn = document.getElementById('vc-view-anki');
                    if (viewBtn) {
                        viewBtn.onclick = async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('[VocabCurve] Attempting guiBrowse for nid:', result);
                            try {
                                await window.vocabCurveApi.sendToAnki('guiBrowse', { query: `nid:${result}` });
                                this._showStatusOverlay('📂 Anki Browser opened.', 2000);
                            } catch (guiErr) {
                                console.error('[VocabCurve] guiBrowse failed:', guiErr);
                                this._showStatusOverlay('❌ Could not open Anki browser', 3000);
                            }
                        };
                    }
                }, 100);

                // --- Optional Auto-Sync ---
                if (localStorage.getItem('vc-anki-auto-sync') === 'true') {
                    console.log('[VocabCurve] Triggering auto-sync...');
                    window.vocabCurveApi.sync().catch(e => console.warn('[VocabCurve] Sync failed:', e));
                }

            } catch (err) {
                if (err.message && err.message.toLowerCase().includes('duplicate')) {
                    this._showStatusOverlay('ℹ️ Already in Anki (Duplicate)', 3000);
                    return;
                }
                throw err; // rethrow for catch block
            }

        } catch (err) {
            console.error('[VocabCurve] Anki export error:', err);
            this._showStatusOverlay(`❌ Anki: ${err.message || 'Export failed'}`, 4000);
        }
    }
}

