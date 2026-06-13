/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {log} from '../core/log.js';
import {WebExtension} from '../extension/web-extension.js';
import {Backend} from './backend.js';

/** Entry point. */
async function main() {
    const webExtension = new WebExtension();
    log.configure(webExtension.extensionName);

    const backend = new Backend(webExtension);
    await backend.prepare();
    // VocabCurve Highlighter API proxy to bypass Private Network Access checks in content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'vocabCurveFetchWords') {
            fetch(`http://127.0.0.1:8000/api/user-data/words?lang=${encodeURIComponent(request.lang)}`)
                .then(res => {
                    if (!res.ok) throw new Error('Network response was not ok');
                    return res.json();
                })
                .then(data => sendResponse({ success: true, data }))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // Keep message channel open for async response
        }
    });
}

void main();
