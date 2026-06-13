document.addEventListener('DOMContentLoaded', async () => {
    const tgtLangInput = document.getElementById('vocabcurve-tgt-lang');
    const clearTextsBtn = document.getElementById('vocabcurve-clear-texts');
    const clearMediaBtn = document.getElementById('vocabcurve-clear-media');

    // --- Backend Connection UI ---
    const backendUrlInput = document.getElementById('vc-backend-url');
    const reconnectBtn = document.getElementById('vc-backend-reconnect');
    const statusDot = document.getElementById('vc-backend-status-dot');
    const statusText = document.getElementById('vc-backend-status-text');

    function updateBackendStatusUI(online, url) {
        if (statusDot && statusText) {
            if (online) {
                statusDot.style.backgroundColor = '#4CAF50';
                statusDot.style.boxShadow = '0 0 8px #4CAF50';
                statusText.textContent = `Online — ${url}`;
                statusText.style.color = '#4CAF50';
            } else {
                statusDot.style.backgroundColor = '#f44336';
                statusDot.style.boxShadow = '0 0 8px #f44336';
                statusText.textContent = 'Offline — start the backend via start_backend.bat';
                statusText.style.color = '#f44336';
            }
        }
        if (backendUrlInput && url) {
            backendUrlInput.value = url;
        }
    }

    // Listen for auto-discovery events from the API
    window.addEventListener('vc-backend-status', (e) => {
        updateBackendStatusUI(e.detail.online, e.detail.url);
    });

    // Load saved URL into input
    if (backendUrlInput) {
        backendUrlInput.value = localStorage.getItem('vc-backend-url') || 'http://localhost:8000/api';

        // Manual URL change
        backendUrlInput.addEventListener('change', async (e) => {
            let url = e.target.value.trim();
            if (url && !url.endsWith('/api')) {
                url = url.replace(/\/+$/, '') + '/api';
                backendUrlInput.value = url;
            }
            localStorage.setItem('vc-backend-url', url);
            if (window.vocabCurveApi) {
                window.vocabCurveApi.baseUrl = url;
                const isOnline = await window.vocabCurveApi.checkStatus();
                updateBackendStatusUI(isOnline, url);
            }
        });
    }

    // Reconnect / auto-discover button
    if (reconnectBtn) {
        reconnectBtn.addEventListener('click', async () => {
            reconnectBtn.textContent = '⌛ Scanning...';
            reconnectBtn.disabled = true;
            if (window.vocabCurveApi) {
                await window.vocabCurveApi.rediscover();
                const url = window.vocabCurveApi.baseUrl;
                const online = window.vocabCurveApi.isOnline;
                updateBackendStatusUI(online, url);
                if (backendUrlInput) backendUrlInput.value = url;
            }
            reconnectBtn.textContent = '🔍 Auto-discover';
            reconnectBtn.disabled = false;
        });
    }

    // Initial status check
    if (window.vocabCurveApi) {
        const isOnline = await window.vocabCurveApi.checkStatus();
        updateBackendStatusUI(isOnline, window.vocabCurveApi.baseUrl);
    }

    if (tgtLangInput) {
        let currentLang = localStorage.getItem('vocabcurve_tgt_lang') || 'rus_Cyrl';
        tgtLangInput.value = currentLang;
        chrome.storage.local.set({ vocabcurve_tgt_lang: currentLang });

        tgtLangInput.addEventListener('change', (e) => {
            const val = e.target.value;
            localStorage.setItem('vocabcurve_tgt_lang', val);
            chrome.storage.local.set({ vocabcurve_tgt_lang: val });
        });
    }

    if (clearTextsBtn) {
        clearTextsBtn.addEventListener('click', async () => {
            const res = await window.vocabCurveApi.clearTextsCache();
            if (res.status === 'success') {
                alert(`Successfully cleared ${res.removed} text cache files.`);
            } else {
                alert(`Failed to clear text cache: ${res.message}`);
            }
        });
    }

    if (clearMediaBtn) {
        clearMediaBtn.addEventListener('click', async () => {
            const res = await window.vocabCurveApi.clearMediaCache();
            if (res.status === 'success') {
                alert(`Successfully cleared ${res.removed} media cache files (images/tts).`);
            } else {
                alert(`Failed to clear media cache: ${res.message}`);
            }
        });
    }

    // Anki Settings Enhancement
    const deckSelect = document.getElementById('vc-anki-deck');
    const modelSelect = document.getElementById('vc-anki-model');
    const refreshBtn = document.getElementById('vc-anki-refresh');
    const babbelBtn = document.getElementById('vc-anki-setup-babbel');
    const fieldSelects = document.querySelectorAll('.vc-field-select');

    async function refreshAnkiData() {
        if (!deckSelect || !modelSelect) return;

        try {
            const [decks, models] = await Promise.all([
                window.vocabCurveApi.getAnkiDecks(),
                window.vocabCurveApi.getAnkiModels()
            ]);

            const savedDeck = localStorage.getItem('vc-anki-deck');
            const savedModel = localStorage.getItem('vc-anki-model');

            // Populate Decks
            deckSelect.innerHTML = decks.map(d => `<option value="${d}" ${d === savedDeck ? 'selected' : ''}>${d}</option>`).join('');
            if (!savedDeck && decks.length > 0) localStorage.setItem('vc-anki-deck', decks[0]);

            // Populate Models
            modelSelect.innerHTML = models.map(m => `<option value="${m}" ${m === savedModel ? 'selected' : ''}>${m}</option>`).join('');
            if (!savedModel && models.length > 0) localStorage.setItem('vc-anki-model', models[0]);

            // Trigger field refresh for currently selected model
            if (modelSelect.value) {
                await refreshFields(modelSelect.value);
            }

        } catch (err) {
            console.error('[VocabCurve] Failed to fetch Anki data:', err);
            alert('Could not connect to Anki. Make sure Anki is running with AnkiConnect installed.');
        }
    }

    async function refreshFields(modelName) {
        try {
            const fields = await window.vocabCurveApi.getAnkiModelFields(modelName);
            fieldSelects.forEach(select => {
                const savedField = localStorage.getItem(select.id);
                select.innerHTML = '<option value="">(None)</option>' + 
                    fields.map(f => `<option value="${f}" ${f === savedField ? 'selected' : ''}>${f}</option>`).join('');
            });
        } catch (err) {
            console.error('[VocabCurve] Failed to fetch fields:', err);
        }
    }

    // --- Anki Setup Presets ---
    const presetSelect = document.getElementById('vc-anki-preset');
    if (presetSelect) {
        const savedPreset = localStorage.getItem('vc-anki-preset') || 'manual';
        presetSelect.value = savedPreset;

        presetSelect.addEventListener('change', async (e) => {
            const preset = e.target.value;
            localStorage.setItem('vc-anki-preset', preset);

            if (preset === 'babbel-v3') {
                if (!confirm('Apply "Babbel V3" preset? This will create a specific Note Type in Anki and auto-configure all fields. Continue?')) {
                    presetSelect.value = 'manual';
                    return;
                }
                await applyBabbelPreset();
            } else if (preset === 'minimal') {
                await applyMinimalPreset();
            }
        });
    }

    async function applyBabbelPreset() {
        try {
            const presetEl = document.getElementById('vc-anki-preset');
            if (presetEl) presetEl.disabled = true;

            await window.vocabCurveApi.createBabbelModel();
            await refreshAnkiData();
            
            // Set model
            const targetModel = 'Vocabitan Babbel V3';
            modelSelect.value = targetModel;
            localStorage.setItem('vc-anki-model', targetModel);
            await refreshFields(targetModel);

            // Detailed mapping
            const mappings = {
                'vc-anki-field-word': 'Word',
                'vc-anki-field-dictionary': 'DictionaryInfo',
                'vc-anki-field-translation': 'Translation',
                'vc-anki-field-sentence-translation': 'SentenceTranslation',
                'vc-anki-field-sentence': 'Context',
                'vc-anki-field-image': 'Image',
                'vc-anki-field-word-tts': 'WordAudio',
                'vc-anki-field-sentence-tts': 'ContextAudio'
            };
            for (const [id, val] of Object.entries(mappings)) {
                const el = document.getElementById(id);
                if (el) { el.value = val; localStorage.setItem(id, val); }
            }

            // Toggles
            const toggles = [
                'vc-anki-export-word', 'vc-anki-export-dictionary', 'vc-anki-export-translation',
                'vc-anki-export-sentence-translation', 'vc-anki-export-sentence', 'vc-anki-export-image',
                'vc-anki-export-word-tts', 'vc-anki-export-sentence-tts'
            ];
            toggles.forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.checked = true; localStorage.setItem(id, 'true'); }
            });

            if (presetEl) presetEl.disabled = false;
            alert('Babbel V3 Preset Applied!');
        } catch (err) {
            console.error('Babbel preset error:', err);
            alert('Failed to apply Babbel preset. Is Anki open?');
            if (presetSelect) presetSelect.value = 'manual';
        }
    }

    async function applyMinimalPreset() {
        // Minimal doesn't need a special note type, just maps common fields
        const mappings = {
            'vc-anki-field-word': 'Word',
            'vc-anki-field-dictionary': '(None)',
            'vc-anki-field-translation': '(None)',
            'vc-anki-field-sentence': 'Context',
            'vc-anki-field-image': '(None)',
            'vc-anki-field-word-tts': 'Audio',
            'vc-anki-field-sentence-tts': '(None)'
        };
        for (const [id, val] of Object.entries(mappings)) {
            const el = document.getElementById(id);
            if (el) { el.value = val; localStorage.setItem(id, val); }
        }
        // Specific toggles
        const active = ['vc-anki-export-word', 'vc-anki-export-word-tts'];
        const inactive = ['vc-anki-export-dictionary', 'vc-anki-export-translation', 'vc-anki-export-image'];
        active.forEach(id => { const el = document.getElementById(id); if(el) el.checked=true; localStorage.setItem(id, 'true'); });
        inactive.forEach(id => { const el = document.getElementById(id); if(el) el.checked=false; localStorage.setItem(id, 'false'); });
        
        alert('Minimalist Preset Applied (Manual Model Selection may be required if fields differ).');
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshAnkiData);
    }

    if (babbelBtn) {
        babbelBtn.addEventListener('click', async () => {
            if (!confirm('This will create a new Note Type "Vocabitan Babbel V2" in your Anki and configure all settings to match the Babbel-style layout. Continue?')) return;
            
            try {
                babbelBtn.textContent = '⌛ Creating...';
                await window.vocabCurveApi.createBabbelModel();
                
                // 1. Force refresh lists
                await refreshAnkiData();
                
                // 2. Select the new model
                modelSelect.value = 'Vocabitan Babbel V3';
                localStorage.setItem('vc-anki-model', 'Vocabitan Babbel V3');
                
                // 3. Update field mappings to match the new model's fields
                await refreshFields('Vocabitan Babbel V3');
                
                const mappings = {
                    'vc-anki-field-word': 'Word',
                    'vc-anki-field-dictionary': 'DictionaryInfo',
                    'vc-anki-field-translation': 'Translation',
                    'vc-anki-field-sentence-translation': 'SentenceTranslation',
                    'vc-anki-field-sentence': 'Context',
                    'vc-anki-field-image': 'Image',
                    'vc-anki-field-word-tts': 'WordAudio',
                    'vc-anki-field-sentence-tts': 'ContextAudio'
                };

                for (const [id, fieldName] of Object.entries(mappings)) {
                    const el = document.getElementById(id);
                    if (el) {
                        el.value = fieldName;
                        localStorage.setItem(id, fieldName);
                    }
                }

                // 4. Enable all toggles
                const toggles = [
                    'vc-anki-export-word', 'vc-anki-export-dictionary', 'vc-anki-export-translation',
                    'vc-anki-export-sentence-translation', 'vc-anki-export-sentence',
                    'vc-anki-export-image', 'vc-anki-export-word-tts', 'vc-anki-export-sentence-tts',
                    'vc-anki-auto-sync'
                ];
                toggles.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) { el.checked = true; localStorage.setItem(id, 'true'); }
                });

                babbelBtn.textContent = '✅ Setup Complete!';
                setTimeout(() => { babbelBtn.textContent = 'Setup Babbel-Style'; }, 3000);
                alert('Babbel-style mode configured successfully!');

            } catch (err) {
                console.error('[VocabCurve] Babbel setup failed:', err);
                alert('Failed to setup Babbel-style: ' + err.message);
                babbelBtn.textContent = '❌ Failed';
            }
        });
    }

    if (deckSelect) {
        deckSelect.addEventListener('change', (e) => localStorage.setItem('vc-anki-deck', e.target.value));
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            localStorage.setItem('vc-anki-model', val);
            await refreshFields(val);
        });
    }

    fieldSelects.forEach(select => {
        select.addEventListener('change', (e) => localStorage.setItem(select.id, e.target.value));
    });

    // Initial load
    refreshAnkiData();

    // Preserve boolean toggles
    const boolSettings = [
        'vc-anki-export-word', 'vc-anki-export-dictionary', 'vc-anki-export-translation',
        'vc-anki-export-sentence-translation', 'vc-anki-export-sentence',
        'vc-anki-export-image', 'vc-anki-export-word-tts', 'vc-anki-export-sentence-tts',
        'vc-anki-allow-duplicate', 'vc-anki-auto-sync'
    ];
    boolSettings.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const saved = localStorage.getItem(id);
            if (saved !== null) el.checked = (saved === 'true');
            el.addEventListener('change', (e) => localStorage.setItem(id, e.target.checked));
        }
    });

    // Preserve voice select dropdowns
    const voiceLangs = ['en', 'es', 'de', 'ru', 'pl'];
    voiceLangs.forEach(lang => {
        const id = `vc-tts-voice-${lang}`;
        const el = document.getElementById(id);
        if (el) {
            const saved = localStorage.getItem(id);
            if (saved !== null) el.value = saved;
            el.addEventListener('change', (e) => localStorage.setItem(id, e.target.value.trim()));
        }
    });

    // TTS Voice Testing
    document.querySelectorAll('.vc-tts-test-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const lang = e.currentTarget.getAttribute('data-lang');
            const testPhrases = {
                'en': 'Testing the selected English voice.',
                'es': 'Probando la voz española seleccionada.',
                'de': 'Testen der ausgewählten deutschen Stimme.',
                'ru': 'Проверка выбранного русского голоса.',
                'pl': 'Testowanie wybranego polskiego głosu.'
            };
            const text = testPhrases[lang] || 'Test';
            
            try {
                e.currentTarget.textContent = '⌛';
                const currentVoice = document.getElementById(`vc-tts-voice-${lang}`)?.value || '';
                const url = await window.vocabCurveApi.generateTTS(text, 'test', lang, false, currentVoice);
                const audio = new Audio(url);
                audio.play();
                e.currentTarget.textContent = '▶️';
            } catch (err) {
                console.error('[VocabCurve] TTS Test failed:', err);
                e.currentTarget.textContent = '❌';
                setTimeout(() => { e.currentTarget.textContent = '▶️'; }, 2000);
            }
        });
    });
});
