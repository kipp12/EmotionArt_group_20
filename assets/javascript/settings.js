/**
 * Settings — global preferences manager (loaded on every page via _sidebar.html).
 *
 * Responsibilities:
 *   1. Persist user settings to localStorage under 'emotionart-settings'.
 *   2. Apply visual preferences (theme, density, retro font, accessibility)
 *      by setting data-* attributes on <html>, which the CSS in base.css reads.
 *   3. On the /settings page only: populate the form, handle save/reset,
 *      manage the large-model download panel, and expose gallery management buttons.
 *
 * Settings keys:
 *   appearance_theme         — 'light' | 'dark'
 *   appearance_density       — 'comfortable' | 'compact'
 *   appearance_retro         — 'default' | 'reduced'  (pixel font vs modern font)
 *   accessibility_large_text — boolean
 *   accessibility_high_contrast_mode — 'off' | 'light' | 'dark'
 *   accessibility_reduced_motion — boolean
 *   accessibility_disable_focus_styles — boolean
 *   audio_microphone_access  — 'enabled' | 'disabled'  (fully allow/block microphone features)
 *   audio_default_mic        — 'manual' | 'auto'  (auto-start mic on page load)
 *   audio_transcript_persistence — 'keep' | 'clear'  (clear transcript after analysis)
 *   model_classifier         — 'base' | 'large'  (which HuggingFace model to use)
 *   saving_format            — 'png' (currently only PNG is supported)
 *   saving_filename_pattern  — template string e.g. 'MY [PAGE_NAME] ART [NUMBER]'
 *
 * Exposed globally:
 *   window.getEmotionArtSettings() — returns the current normalised settings object.
 *     Used by every theme's app controller to read model_classifier and audio prefs.
 */
(function () {
    // localStorage key where all settings are persisted as a JSON string.
    const STORAGE_KEY = 'emotionart-settings';

    // Whitelist of accepted model_classifier values.
    const VALID_MODEL_CLASSIFIERS = new Set(['base', 'large']);

    // Default settings — used on first visit or after a reset.
    const DEFAULT_SETTINGS = {
        appearance_theme: 'light',
        appearance_density: 'comfortable',
        appearance_retro: 'default',
        accessibility_large_text: false,
        accessibility_high_contrast_mode: 'off',
        accessibility_reduced_motion: false,
        accessibility_disable_focus_styles: false,
        audio_microphone_access: 'enabled',
        audio_default_mic: 'manual',
        audio_transcript_persistence: 'keep',
        model_classifier: 'base',
        saving_format: 'png',
        saving_filename_pattern: 'MY [PAGE_NAME] ART [NUMBER]',
    };

    /**
     * Merge raw settings with defaults, ensuring all keys exist
     * and the model_classifier value is valid.
     */
    function normalizeSettings(rawSettings) {
        const settings = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
        if (!VALID_MODEL_CLASSIFIERS.has(settings.model_classifier)) {
            settings.model_classifier = DEFAULT_SETTINGS.model_classifier;
        }
        if (!['off', 'light', 'dark'].includes(settings.accessibility_high_contrast_mode)) {
            settings.accessibility_high_contrast_mode = DEFAULT_SETTINGS.accessibility_high_contrast_mode;
        }
        if (!['enabled', 'disabled'].includes(settings.audio_microphone_access)) {
            settings.audio_microphone_access = DEFAULT_SETTINGS.audio_microphone_access;
        }
        if (typeof rawSettings?.accessibility_disable_focus_styles !== 'boolean'
            && typeof rawSettings?.accessibility_focus_visibility === 'boolean') {
            settings.accessibility_disable_focus_styles = !rawSettings.accessibility_focus_visibility;
        }
        return settings;
    }

    /**
     * Read settings from localStorage, filter to only known keys,
     * and return a normalised copy. Returns defaults if nothing is stored.
     */
    function readStoredSettings() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return { ...DEFAULT_SETTINGS };
            const parsed = JSON.parse(raw);
            // Only keep keys that exist in DEFAULT_SETTINGS (ignore stale keys)
            const filtered = Object.fromEntries(
                Object.keys(DEFAULT_SETTINGS)
                    .filter(key => Object.prototype.hasOwnProperty.call(parsed, key))
                    .map(key => [key, parsed[key]])
            );
            if (!Object.prototype.hasOwnProperty.call(filtered, 'accessibility_disable_focus_styles')
                && Object.prototype.hasOwnProperty.call(parsed, 'accessibility_focus_visibility')) {
                filtered.accessibility_disable_focus_styles = !parsed.accessibility_focus_visibility;
            }
            return normalizeSettings(filtered);
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    }

    /**
     * Write normalised settings to localStorage.
     */
    function writeStoredSettings(settings) {
        const normalized = normalizeSettings(settings);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }

    /**
     * Apply visual settings by setting data-* attributes on <html>.
     * CSS rules in base.css use these attributes to switch themes, fonts,
     * motion, and text sizes without any JS DOM manipulation.
     */
    function applySettings(settings) {
        const root = document.documentElement;
        const highContrastEnabled = settings.accessibility_high_contrast_mode !== 'off';
        root.dataset.appTheme = highContrastEnabled
            ? settings.accessibility_high_contrast_mode
            : settings.appearance_theme;
        root.dataset.appDensity = settings.appearance_density;
        root.dataset.appRetro = settings.appearance_retro;
        root.dataset.largeText = String(!!settings.accessibility_large_text);
        root.dataset.highContrast = String(highContrastEnabled);
        root.dataset.highContrastMode = settings.accessibility_high_contrast_mode;
        root.dataset.reducedMotion = String(!!settings.accessibility_reduced_motion);
        root.dataset.disableFocusStyles = String(!!settings.accessibility_disable_focus_styles);
        // Also store on window so other scripts can access without reading localStorage
        window.EmotionArtSettings = settings;
    }

    /**
     * Populate the settings form fields from a settings object.
     * Handles both checkboxes (checked property) and other inputs (value property).
     */
    function populateForm(form, settings) {
        Object.entries(settings).forEach(([key, value]) => {
            const field = form.elements.namedItem(key);
            if (!field) return;
            if (field.type === 'checkbox') {
                field.checked = !!value;
            } else {
                field.value = value;
            }
        });
    }

    /**
     * Read the current form state back into a settings object.
     */
    function readForm(form) {
        const settings = { ...DEFAULT_SETTINGS };
        Object.keys(DEFAULT_SETTINGS).forEach(key => {
            const field = form.elements.namedItem(key);
            if (!field) return;
            settings[key] = field.type === 'checkbox' ? field.checked : field.value;
        });
        return normalizeSettings(settings);
    }

    /**
     * Show a status message (e.g. "Settings saved") on the settings page.
     */
    function syncStatus(message, tone) {
        const status = document.getElementById('settings-status');
        if (!status) return;
        status.textContent = message;
        status.dataset.tone = tone || 'neutral';
    }

    // -----------------------------------------------------------------------
    // Large model download panel (settings page only)
    // -----------------------------------------------------------------------

    function getModelStatusElements() {
        return {
            panel: document.getElementById('model-download-panel'),
            title: document.getElementById('model-download-title'),
            state: document.getElementById('model-download-state'),
            copy: document.getElementById('model-download-copy'),
            loading: document.getElementById('model-download-loading'),
        };
    }

    /**
     * Update the model download panel UI based on the server's reported state.
     */
    function syncModelStatus(status) {
        const { panel, title, state, copy, loading } = getModelStatusElements();
        if (!panel || !state || !copy || !title || !loading) return;

        const nextState = status?.state || 'idle';
        panel.hidden = false;
        panel.dataset.state = nextState;
        title.textContent = 'Large Model Download';
        state.dataset.state = nextState;
        state.textContent = nextState;
        loading.hidden = nextState !== 'loading';

        if (nextState === 'loading') {
            copy.textContent = 'Large model is downloading. This can take around 10-15 minutes on a first time download.';
            return;
        }

        if (nextState === 'ready') {
            copy.textContent = 'Large model is ready to use.';
            return;
        }

        if (nextState === 'error') {
            copy.textContent = status.details || 'Large model could not be prepared. Check the server console for more detail.';
            return;
        }

        copy.textContent = 'Large model download has not started.';
    }

    /**
     * Fetch the large model's current state from the server.
     */
    async function fetchModelStatus() {
        const response = await fetch('/api/settings/model-status?model=large');
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Unable to read model status');
        }
        syncModelStatus(payload);
        return payload;
    }

    /**
     * Ask the server to start downloading the large model in the background.
     */
    async function startLargeModelPreload() {
        const response = await fetch('/api/settings/model-preload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'large' }),
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Unable to start large model loading');
        }
        syncModelStatus(payload);
        return payload;
    }

    // -----------------------------------------------------------------------
    // Settings page bootstrap (only runs if the settings form exists in the DOM)
    // -----------------------------------------------------------------------

    function bootSettingsPage() {
        const form = document.getElementById('settings-form');
        if (!form) return;

        // Populate form with stored values, then write them back (migration step
        // — ensures any new default keys are persisted on upgrade).
        const storedSettings = readStoredSettings();
        populateForm(form, storedSettings);
        writeStoredSettings(storedSettings);

        const saveButton = document.getElementById('save-settings');
        const resetButton = document.getElementById('restore-settings');
        const clearMetadataButton = document.getElementById('clear-metadata');
        const clearGalleryButton = document.getElementById('clear-gallery');
        const modelSelector = form.elements.namedItem('model_classifier');

        // Poll handle for checking large-model download progress.
        let modelStatusPoll = null;

        function stopModelPolling() {
            if (modelStatusPoll) {
                window.clearInterval(modelStatusPoll);
                modelStatusPoll = null;
            }
        }

        async function refreshModelStatus() {
            try {
                const payload = await fetchModelStatus();
                // Stop polling once the model reaches a terminal state.
                if (payload.state === 'ready' || payload.state === 'error' || payload.state === 'idle') {
                    stopModelPolling();
                }
            } catch (error) {
                syncModelStatus({ state: 'error', details: error.message || 'Unable to read model status.' });
                stopModelPolling();
            }
        }

        function ensureModelPolling() {
            stopModelPolling();
            // Poll every 3 seconds until the download completes.
            modelStatusPoll = window.setInterval(refreshModelStatus, 3000);
        }

        // On load: check large-model status once (unless already selected as 'large').
        if (modelSelector) {
            if (modelSelector.value !== 'large') {
                fetchModelStatus().catch(() => {
                    syncModelStatus({ state: 'idle' });
                });
            }

            // When the user switches to the large model, trigger the download.
            modelSelector.addEventListener('change', async () => {
                if (modelSelector.value === 'large') {
                    syncStatus('Large Model may take a while to download and prepare the first time you select it.', 'neutral');
                    syncModelStatus({ state: 'loading' });
                    try {
                        await startLargeModelPreload();
                        ensureModelPolling();
                    } catch (error) {
                        syncModelStatus({ state: 'error', details: error.message || 'Unable to start large model loading.' });
                    }
                    return;
                }

                stopModelPolling();
                try {
                    await fetchModelStatus();
                } catch (error) {
                    syncModelStatus({ state: 'idle' });
                }
            });
        }

        // If the user already has 'large' selected, start polling immediately.
        if (storedSettings.model_classifier === 'large') {
            syncModelStatus({ state: 'loading' });
            refreshModelStatus();
            ensureModelPolling();
        } else {
            fetchModelStatus().catch(() => {
                syncModelStatus({ state: 'idle' });
            });
        }

        // Save button — persist current form state and apply visual changes.
        saveButton?.addEventListener('click', event => {
            event.preventDefault();
            const settings = readForm(form);
            writeStoredSettings(settings);
            applySettings(settings);
            syncStatus('Settings saved', 'success');
        });

        // Reset button — restore all settings to factory defaults.
        resetButton?.addEventListener('click', event => {
            event.preventDefault();
            writeStoredSettings(DEFAULT_SETTINGS);
            populateForm(form, DEFAULT_SETTINGS);
            applySettings(DEFAULT_SETTINGS);
            stopModelPolling();
            syncStatus('Defaults restored', 'neutral');
            fetchModelStatus().catch(() => {
                syncModelStatus({ state: 'idle' });
            });
        });

        const metadataModal = document.getElementById('clear-metadata-modal');
        const metadataConfirm = document.getElementById('metadata-confirm');
        const metadataCancel = document.getElementById('metadata-cancel');

        // Clear gallery — delete everything (images + metadata).
        // Requires the user to type "DELETE" in a confirmation modal before proceeding.
        const modal = document.getElementById('clear-gallery-modal');
        const modalInput = document.getElementById('modal-confirm-input');
        const modalOk = document.getElementById('modal-confirm');
        const modalCancel = document.getElementById('modal-cancel');
        const modalBackdrops = [metadataModal, modal].filter(Boolean);
        let activeModal = null;
        let previousFocus = null;

        function setBackgroundInert(isInert) {
            Array.from(document.body.children).forEach(child => {
                if (modalBackdrops.includes(child) || child.tagName === 'SCRIPT') return;
                if (isInert) {
                    child.dataset.wasInert = child.inert ? 'true' : 'false';
                    child.inert = true;
                    child.setAttribute('aria-hidden', 'true');
                } else {
                    child.inert = child.dataset.wasInert === 'true';
                    child.removeAttribute('aria-hidden');
                    delete child.dataset.wasInert;
                }
            });
        }

        function getFocusable(container) {
            return Array.from(container.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
            ));
        }

        function closeModal(targetModal) {
            if (!targetModal) return;
            targetModal.classList.remove('is-open');
            if (targetModal === modal && modalInput && modalOk) {
                modalInput.value = '';
                modalOk.disabled = true;
            }
            activeModal = null;
            setBackgroundInert(false);
            document.removeEventListener('keydown', onModalKeyDown, true);
            previousFocus?.focus?.();
        }

        function onModalKeyDown(event) {
            if (!activeModal) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                closeModal(activeModal);
                return;
            }

            if (event.key !== 'Tab') return;
            const box = activeModal.querySelector('.modal-box');
            const focusable = getFocusable(box);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        function openModal(targetModal, focusTarget) {
            if (!targetModal) return;
            previousFocus = document.activeElement;
            activeModal = targetModal;
            targetModal.classList.add('is-open');
            setBackgroundInert(true);
            document.addEventListener('keydown', onModalKeyDown, true);
            window.setTimeout(() => {
                focusTarget?.focus();
                focusTarget?.select?.();
            }, 0);
        }

        clearMetadataButton?.addEventListener('click', event => {
            event.preventDefault();
            openModal(metadataModal, metadataCancel || metadataConfirm);
        });

        metadataCancel?.addEventListener('click', () => closeModal(metadataModal));

        metadataConfirm?.addEventListener('click', async () => {
            closeModal(metadataModal);
            const response = await fetch('/api/settings/clear-metadata', { method: 'POST' });
            const payload = await response.json();
            syncStatus(response.ok ? 'Saved metadata cleared' : (payload.error || 'Unable to clear metadata'), response.ok ? 'success' : 'error');
        });

        clearGalleryButton?.addEventListener('click', event => {
            event.preventDefault();
            if (modalInput && modalOk) {
                modalInput.value = '';
                modalOk.disabled = true;
            }
            openModal(modal, modalInput);
        });

        modalInput?.addEventListener('input', () => {
            modalOk.disabled = modalInput.value.trim() !== 'DELETE';
        });

        modalCancel?.addEventListener('click', () => closeModal(modal));

        modalBackdrops.forEach(dialog => {
            dialog?.addEventListener('click', e => {
                if (e.target === dialog) {
                    closeModal(dialog);
                }
            });
        });

        modalOk?.addEventListener('click', async () => {
            closeModal(modal);
            const response = await fetch('/api/settings/clear-gallery', { method: 'POST' });
            const payload = await response.json();
            syncStatus(response.ok ? 'Gallery cleared' : (payload.error || 'Unable to clear gallery'), response.ok ? 'success' : 'error');
        });

        // H5-03: Filename pattern real-time validation — flag characters that are
        // illegal in Windows and Linux filenames before the user tries to save.
        const filenamePatternInput = form.elements.namedItem('saving_filename_pattern');
        const filenamePatternError = document.getElementById('filename-pattern-error');
        const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/;

        if (filenamePatternInput && filenamePatternError) {
            filenamePatternInput.addEventListener('input', () => {
                const val = filenamePatternInput.value;
                if (ILLEGAL_FILENAME_CHARS.test(val)) {
                    filenamePatternError.textContent = 'Cannot contain: / \\ : * ? " < > |';
                    filenamePatternInput.setAttribute('aria-invalid', 'true');
                } else {
                    filenamePatternError.textContent = '';
                    filenamePatternInput.removeAttribute('aria-invalid');
                }
            });
        }
    }

    // -----------------------------------------------------------------------
    // Immediate execution: apply stored settings on every page load
    // (runs before DOMContentLoaded so the theme is set before first paint).
    // -----------------------------------------------------------------------
    const initialSettings = readStoredSettings();
    applySettings(initialSettings);

    // Boot the settings page form (no-op if the form element doesn't exist).
    document.addEventListener('DOMContentLoaded', () => {
        bootSettingsPage();
    });

    // Expose a global getter so other scripts (theme app controllers, gallery-save)
    // can read the current settings without touching localStorage directly.
    window.getEmotionArtSettings = function () {
        return readStoredSettings();
    };

    // Expose a toast notification helper used by gallery pages and gallery-save.js
    // instead of window.alert(). Creates a dismissing banner at the bottom of the page.
    window.showToast = function showToast(message) {
        const el = document.createElement('div');
        el.className = 'ea-toast';
        el.textContent = message;
        document.body.appendChild(el);
        window.setTimeout(() => {
            el.classList.add('ea-toast-fade');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
        }, 2500);
    };
})();
