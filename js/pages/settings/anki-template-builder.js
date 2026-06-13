import {AnkiConnect} from '../../comm/anki-connect.js';

export class AnkiTemplateBuilder {
    constructor() {
        this._ankiConnect = new AnkiConnect();
        
        this._elements = {
            modelSelect: document.querySelector('#anki-builder-model-select'),
            cardSelect: document.querySelector('#anki-builder-card-select'),
            editor: document.querySelector('#anki-builder-editor'),
            previewArea: document.querySelector('#anki-builder-preview-area'),
            saveBtn: document.querySelector('#anki-template-save'),
            tabRadios: document.querySelectorAll('input[name="anki-builder-tab"]'),
            previewRadios: document.querySelectorAll('input[name="anki-builder-preview"]')
        };
        
        this._state = {
            models: [],
            currentModel: null,
            templates: {}, // { "Card 1": { Front: "...", Back: "..." } }
            css: "",
            fields: [],
            currentTab: 'front', // 'front', 'back', 'css'
            currentPreview: 'front' // 'front', 'back'
        };

        this._shadowRoot = this._elements.previewArea.attachShadow({mode: 'open'});
    }

    async init() {
        if (!this._elements.modelSelect) return;

        // Fetch server details from settings or DOM 
        const ankiServerInput = document.querySelector('[data-setting="anki.server"]');
        if (ankiServerInput) {
            this._ankiConnect.server = ankiServerInput.value || 'http://127.0.0.1:8765';
        } else {
            this._ankiConnect.server = 'http://127.0.0.1:8765';
        }
        this._ankiConnect.enabled = true; // Assume true since we are trying to use it

        try {
            this._state.models = await this._ankiConnect.getModelNames();
        } catch (e) {
            this._elements.modelSelect.innerHTML = '<option disabled selected>Anki connection failed</option>';
            return;
        }

        this._elements.modelSelect.innerHTML = '<option disabled selected>Select an Anki Model...</option>';
        for (const model of this._state.models) {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            this._elements.modelSelect.appendChild(option);
        }

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this._elements.modelSelect.addEventListener('change', () => this._onModelSelected());
        this._elements.cardSelect.addEventListener('change', () => this._onCardSelected());
        
        this._elements.editor.addEventListener('input', () => this._onEditorInput());
        
        for (const radio of this._elements.tabRadios) {
            radio.addEventListener('change', (e) => this._onTabChanged(e.target.value));
        }

        for (const radio of this._elements.previewRadios) {
            radio.addEventListener('change', (e) => this._onPreviewChanged(e.target.value));
        }

        this._elements.saveBtn.addEventListener('click', () => this._onSave());
    }

    async _onModelSelected() {
        const modelName = this._elements.modelSelect.value;
        this._state.currentModel = modelName;
        
        // Fetch all templates, css and fields for the model
        try {
            const [templates, stylingObj, fields] = await Promise.all([
                this._ankiConnect.getModelTemplates(modelName),
                this._ankiConnect.getModelStyling(modelName),
                this._ankiConnect.getModelFieldNames(modelName)
            ]);
            
            this._state.templates = templates;
            this._state.css = stylingObj.css || "";
            this._state.fields = fields;

            // Populate cards select
            this._elements.cardSelect.innerHTML = '';
            for (const cardName in templates) {
                const option = document.createElement('option');
                option.value = cardName;
                option.textContent = cardName;
                this._elements.cardSelect.appendChild(option);
            }

            if (Object.keys(templates).length > 0) {
                this._elements.cardSelect.value = Object.keys(templates)[0];
            }

            this._updateEditorContent();
            this._updatePreview();

        } catch (e) {
            console.error("Failed to load model details from Anki", e);
            alert("Error loading model details from Anki: " + e.message);
        }
    }

    _onCardSelected() {
        this._updateEditorContent();
        this._updatePreview();
    }

    _onTabChanged(tabName) {
        this._state.currentTab = tabName;
        this._updateEditorContent();
    }

    _onPreviewChanged(previewName) {
        this._state.currentPreview = previewName;
        this._updatePreview();
    }

    _onEditorInput() {
        const value = this._elements.editor.value;
        const cardName = this._elements.cardSelect.value;
        
        if (!cardName) return;

        if (this._state.currentTab === 'css') {
            this._state.css = value;
        } else if (this._state.currentTab === 'front') {
            this._state.templates[cardName].Front = value;
        } else if (this._state.currentTab === 'back') {
            this._state.templates[cardName].Back = value;
        }

        this._updatePreview();
    }

    _updateEditorContent() {
        const cardName = this._elements.cardSelect.value;
        if (!cardName) return;

        const template = this._state.templates[cardName];
        if (!template) return;

        if (this._state.currentTab === 'css') {
            this._elements.editor.value = this._state.css;
        } else if (this._state.currentTab === 'front') {
            this._elements.editor.value = template.Front;
        } else if (this._state.currentTab === 'back') {
            this._elements.editor.value = template.Back;
        }
    }

    _updatePreview() {
        const cardName = this._elements.cardSelect.value;
        if (!cardName) {
            this._shadowRoot.innerHTML = '';
            return;
        }

        const template = this._state.templates[cardName];
        if (!template) return;

        let html = this._state.currentPreview === 'front' ? template.Front : template.Back;
        let css = this._state.css;

        // Anki special field FrontSide replacement in Back Template
        if (this._state.currentPreview === 'back') {
            html = html.replace(/\{\{FrontSide\}\}/g, template.Front);
        }

        // Render Anki fields to dummy placeholders
        let output = html;
        
        // Remove {{type:XXX}} as it causes UI layout issues in preview
        output = output.replace(/\{\{type:(.*?)\}\}/g, '<input type="text" placeholder="Type answer..." class="demo-type-input" style="width:100%; border:1px solid #ccc; background:#fff; padding:5px; margin: 10px 0;">');

        // Conditionals {{#Field}} ... {{/Field}}
        output = output.replace(/\{\{#(.*?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, field, content) => {
            return content; // Always show truthy conditional branch
        });
        
        // Negative Conditionals {{^Field}} ... {{/Field}}
        output = output.replace(/\{\{\^(.*?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, '');
        
        // Final Replacement for {{Field}}
        output = output.replace(/\{\{(.*?)\}\}/g, (match, field) => {
            field = field.trim();
            // Drop modifiers
            if (field.startsWith('text:')) field = field.replace('text:', '');
            
            field = field.trim();

            if (field.toLowerCase().includes('image') || field.toLowerCase() === 'picture') {
                return `<div style="max-width: 100%; height: 150px; background-color: rgba(255, 255, 255, 0.1); border: 1px dashed rgba(255, 255, 255, 0.3); display: flex; align-items: center; justify-content: center; color: #888;">[ ${field} Placeholder ]</div>`;
            }
            if (field.toLowerCase().includes('audio') || field.toLowerCase().includes('sound')) {
                return `<div style="display:inline-flex; width: 36px; height: 36px; border-radius: 50%; background-color: #333; align-items: center; justify-content: center; color: #fff; cursor: pointer;">▶</div>`;
            }
            
            return `<span style="background: rgba(255,255,0,0.15); border-bottom: 1px dashed #ff0; padding: 1px 4px; color: #ffeb3b; border-radius: 3px;">[${field}]</span>`;
        });
        
        const fullHtml = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    height: 100%;
                }
                body {
                    margin: 0;
                    padding: 0;
                }
                ${css}
            </style>
            ${output}
        `;

        this._shadowRoot.innerHTML = fullHtml;
    }

    async _onSave() {
        if (!this._state.currentModel) return;

        this._elements.saveBtn.disabled = true;
        this._elements.saveBtn.textContent = 'Saving...';

        try {
            await this._ankiConnect.updateModelStyling(this._state.currentModel, this._state.css);
            await this._ankiConnect.updateModelTemplates(this._state.currentModel, this._state.templates);
            
            this._elements.saveBtn.textContent = 'Saved!';
            setTimeout(() => {
                this._elements.saveBtn.textContent = 'Save to Anki';
                this._elements.saveBtn.disabled = false;
            }, 2000);
        } catch (e) {
            console.error("Save failed", e);
            alert("Failed to save to Anki: " + e.message);
            this._elements.saveBtn.textContent = 'Save to Anki';
            this._elements.saveBtn.disabled = false;
        }
    }
}
