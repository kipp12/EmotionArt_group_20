async function saveArtwork(options) {
    const saveButton = document.getElementById('save-output');
    if (!saveButton || !options || typeof options.captureImage !== 'function') return;

    saveButton.addEventListener('click', async () => {
        if (saveButton.disabled) return;

        saveButton.disabled = true;
        saveButton.textContent = 'SAVING';

        try {
            const imageData = options.captureImage();
            const transcriptEl = document.getElementById('transcript');
            const transcriptText = typeof options.getTranscript === 'function'
                ? options.getTranscript()
                : (transcriptEl ? transcriptEl.textContent.trim() : '');
            const emotions = typeof options.getEmotions === 'function' ? options.getEmotions() : [];
            const settings = window.getEmotionArtSettings ? window.getEmotionArtSettings() : null;

            const response = await fetch('/api/gallery/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page_name: options.pageName,
                    image_data: imageData,
                    transcript: transcriptText,
                    emotions,
                    filename_pattern: settings?.saving_filename_pattern,
                }),
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Save failed.');
            }

            saveButton.textContent = 'SAVED';
            window.setTimeout(() => {
                saveButton.textContent = 'SAVE';
                saveButton.disabled = false;
            }, 1200);
        } catch (error) {
            window.alert(error.message || 'Save failed.');
            saveButton.textContent = 'SAVE';
            saveButton.disabled = false;
        }
    });
}
