class VocabCurveApi {
    constructor() {
        // Use 127.0.0.1 instead of localhost — on Windows, localhost can resolve
        // to IPv6 ::1 while the Python backend only listens on IPv4 127.0.0.1
        this.baseUrl = 'http://127.0.0.1:8000/api';
        this._backendOnline = false;
    }

    async _fetchWithTimeout(resource, options = {}) {
        const { timeout = 8000 } = options;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    }

    async checkStatus() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const response = await fetch(`${this.baseUrl}/status`, { signal: controller.signal });
            clearTimeout(timeoutId);
            this._backendOnline = response.ok;
            return response.ok;
        } catch (e) {
            this._backendOnline = false;
            return false;
        }
    }

    get isOnline() {
        return this._backendOnline;
    }

    async searchImages(word, lang) {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/images/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word, lang })
            });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            return data.images || [];
        } catch (error) {
            console.error('VocabCurveApi searchImages error:', error);
            return [];
        }
    }

    async saveImage(url, word, lang) {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/images/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, word, lang })
            });
            return await response.json();
        } catch (error) {
            console.error('VocabCurveApi saveImage error:', error);
            return { status: 'error', message: error.message };
        }
    }

    async translateSentence(sentence, src_lang, tgt_lang) {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sentence, src_lang, tgt_lang })
            });
            return await response.json();
        } catch (error) {
            console.error('VocabCurveApi translateSentence error:', error);
            return { status: 'error', message: error.message };
        }
    }

    async generateTTS(text, stem, lang, isContext = false, voiceOverride = null) {
        try {
            const voice = voiceOverride || localStorage.getItem(`vc-tts-voice-${lang}`) || '';
            const response = await this._fetchWithTimeout(`${this.baseUrl}/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, stem, lang, context: isContext, voice: voice })
            });
            const data = await response.json();
            if (data.status === 'success') {
                const nllbToSimple = {
                    'eng_Latn': 'en', 'spa_Latn': 'es', 'deu_Latn': 'de', 'rus_Cyrl': 'ru', 'pol_Latn': 'pl',
                    'en': 'en', 'es': 'es', 'de': 'de', 'ru': 'ru', 'pl': 'pl'
                };
                const simpleLang = nllbToSimple[lang] || lang;
                const baseHost = this.baseUrl.replace(/\/api\/?$/, '');
                return `${baseHost}/userimages/${simpleLang}/${data.filename}`;
            }
            throw new Error(data.message || 'Failed to generate TTS');
        } catch (error) {
            console.error('VocabCurveApi generateTTS error:', error);
            throw error;
        }
    }

    async clearMediaCache() {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/cache/clear-media`, { method: 'POST' });
            return await response.json();
        } catch (error) {
            console.error('VocabCurveApi clearMediaCache error:', error);
            return { status: 'error', message: error.message };
        }
    }

    async clearTextsCache() {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/cache/clear-texts`, { method: 'POST' });
            return await response.json();
        } catch (error) {
            console.error('VocabCurveApi clearTextsCache error:', error);
            return { status: 'error', message: error.message };
        }
    }

    async getDictionaryWords(lang) {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/user-data/words?lang=${lang}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            console.error('VocabCurveApi getDictionaryWords error:', error);
            return { status: 'error', trackedWords: [], knownWords: [] };
        }
    }

    async addWordToDictionary(text, lang) {
        try {
            const response = await this._fetchWithTimeout(`${this.baseUrl}/user-data/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, lang })
            });
            return await response.json();
        } catch (error) {
            console.error('VocabCurveApi addWordToDictionary error:', error);
            return { status: 'error', message: error.message };
        }
    }

    async sendToAnki(action, params = {}) {
        try {
            const response = await this._fetchWithTimeout(`http://127.0.0.1:8765`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action, version: 6, params: params })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            return data.result;
        } catch (error) {
            console.error('VocabCurveApi sendToAnki error:', error);
            throw error;
        }
    }

    async getAnkiDecks() {
        return this.sendToAnki('deckNames');
    }

    async getAnkiModels() {
        return this.sendToAnki('modelNames');
    }

    async getAnkiModelFields(modelName) {
        return this.sendToAnki('modelFieldNames', { modelName });
    }

    async createBabbelModel() {
        const modelName = 'Vocabitan Babbel V3';
        const fields = ['Word', 'DictionaryInfo', 'Context', 'Translation', 'SentenceTranslation', 'Image', 'WordAudio', 'ContextAudio'];
        const css = `
            /* Container and Footer */
            .vc-main-container {
                display: flex;
                flex-direction: column;
                max-width: 550px;
                margin: auto;
                background: transparent;
                text-align: center;
                align-items: center;
            }
            .vc-image-container img {
                width: 100%;
                display: block;
                max-height: 400px;
                object-fit: contain;
                border-radius: 12px;
                margin-bottom: 20px;
            }
            .vc-content {
                padding: 10px 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                width: 100%;
            }

            /* Typography */
            .vc-prompt {
                font-size: 20px;
                font-weight: 400 !important;
                color: #ddd;
                line-height: 1.5; /* Babbel Style v2 */
            }
            .vc-answer {
                font-size: 32px;
                font-weight: 800;
                color: #fff;
                margin-bottom: 20px;
                line-height: 1.2;
            }
            .vc-context-area {
                margin-top: 15px;
                padding-top: 20px;
                border-top: 1px solid rgba(255,255,255,0.1);
                width: 100%;
                text-align: center;
            }
            .vc-context-text {
                font-size: 20px;
                color: #ddd;
                line-height: 1.4;
                margin-bottom: 12px;
            }
            .vc-context-translation {
                font-size: 16px;
                color: #888;
                line-height: 1.4;
            }
            .vc-main-container b {
                color: inherit !important;
                font-weight: 800;
                text-decoration: none !important;
                border: none !important;
            }

            .vc-audio { margin-top: 5px; margin-bottom: 15px; }
            .vc-audio svg, .vc-audio img { filter: invert(0.8); width: 44px; height: 44px; cursor: pointer; }

            /* Bottom Spoiler (Minimalist) */
            .vc-dict-spoiler {
                text-align: left;
                margin: 30px auto 10px auto;
                max-width: 550px;
                border-top: 1px solid rgba(255,255,255,0.05);
            }
            .vc-dict-spoiler > summary {
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
                color: #444;
                padding: 12px 0;
                list-style: none;
                text-align: center;
            }
            .vc-dictionary {
                text-align: left;
                background: rgba(255,255,255,0.02); 
                border-radius: 8px; 
                padding: 16px; 
                font-size: 14px;
                color: #999;
            }
        `;

        // FRONT: Image → Context Sentence (Question)
        const front = `
            <div class="vc-main-container">
              {{#Image}}<div class="vc-image-container">{{Image}}</div>{{/Image}}
              <div class="vc-content">
                <div class="vc-prompt">{{Context}}</div>
              </div>
            </div>
        `;

        // BACK: Image → Word TTS → Context Sentences (with Sentence TTS at bottom)
        const back = `
            <div class="vc-main-container">
              {{#Image}}<div class="vc-image-container">{{Image}}</div>{{/Image}}
              <div class="vc-content">
                {{#WordAudio}}<div class="vc-audio">{{WordAudio}}</div>{{/WordAudio}}
                
                <div class="vc-context-area">
                  {{#Context}}<div class="vc-context-text">{{Context}}</div>{{/Context}}
                  {{#SentenceTranslation}}<div class="vc-context-translation">{{SentenceTranslation}}</div>{{/SentenceTranslation}}
                  {{#ContextAudio}}<div class="vc-audio" style="margin-top:15px;">{{ContextAudio}}</div>{{/ContextAudio}}
                </div>
              </div>
            </div>

            {{#DictionaryInfo}}
            <details class="vc-dict-spoiler">
              <summary>📖 Справка</summary>
              <div class="vc-dictionary">
                {{DictionaryInfo}}
              </div>
            </details>
            {{/DictionaryInfo}}
        `;

        try {
            const existingModels = await this.getAnkiModels();
            if (existingModels && existingModels.includes(modelName)) {
                console.log(`[VocabCurve] Model "${modelName}" already exists, updating styling and templates.`);
                // Try to add SentenceTranslation field if it's missing
                try {
                    const existingFields = await this.getAnkiModelFields(modelName);
                    if (!existingFields.includes('SentenceTranslation')) {
                        await this.sendToAnki('modelFieldAdd', {
                            modelName: modelName,
                            fieldName: 'SentenceTranslation',
                            index: 4 // after Translation
                        });
                        console.log('[VocabCurve] Added SentenceTranslation field to existing model.');
                    }
                } catch (fieldErr) {
                    console.log(`[VocabCurve] Could not add SentenceTranslation field: ${fieldErr}`);
                }
                // Update CSS and templates
                try {
                    await this.sendToAnki('updateModelStyling', {
                        model: { name: modelName, css: css }
                    });
                    await this.sendToAnki('updateModelTemplates', {
                        model: {
                            name: modelName,
                            templates: { 'Card 1': { Front: front, Back: back } }
                        }
                    });
                } catch (updateErr) {
                    console.log(`[VocabCurve] Could not update existing model (${updateErr}), maybe old AnkiConnect version.`);
                }
                return true;
            }
        } catch (err) { /* ignore check errors, try creation anyway */ }

        return this.sendToAnki('createModel', {
            modelName,
            inOrderFields: fields,
            css,
            cardTemplates: [{
                name: 'Card 1',
                Front: front,
                Back: back
            }]
        });
    }

    async sync() {
        return this.sendToAnki('sync');
    }
}

// Attach to window object for broader access across the extension scripts
window.vocabCurveApi = new VocabCurveApi();
