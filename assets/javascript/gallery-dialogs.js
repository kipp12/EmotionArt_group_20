(function () {
    function showToastFallback(message) {
        if (window.showToast) {
            window.showToast(message);
            return;
        }

        const el = document.createElement('div');
        el.className = 'ea-toast';
        el.textContent = message;
        document.body.appendChild(el);
        window.setTimeout(() => {
            el.classList.add('ea-toast-fade');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
        }, 2500);
    }

    function getFocusable(container) {
        return Array.from(container.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => !element.hasAttribute('hidden'));
    }

    function createModalController(backdrop) {
        if (!backdrop) return null;

        const box = backdrop.querySelector('.modal-box');
        let resolver = null;
        let previousFocus = null;

        function setBackgroundInert(isInert) {
            Array.from(document.body.children).forEach((child) => {
                if (child === backdrop || child.tagName === 'SCRIPT') return;
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

        function close(result) {
            backdrop.classList.remove('is-open');
            backdrop.setAttribute('hidden', '');
            setBackgroundInert(false);
            document.removeEventListener('keydown', onKeyDown, true);
            backdrop.removeEventListener('click', onBackdropClick);
            previousFocus?.focus?.();
            if (resolver) {
                resolver(result);
                resolver = null;
            }
        }

        function onBackdropClick(event) {
            if (event.target === backdrop) {
                close(null);
            }
        }

        function onKeyDown(event) {
            if (!backdrop.classList.contains('is-open')) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                close(null);
                return;
            }

            if (event.key !== 'Tab') return;

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

        function open(initialFocus) {
            previousFocus = document.activeElement;
            backdrop.removeAttribute('hidden');
            backdrop.classList.add('is-open');
            setBackgroundInert(true);
            document.addEventListener('keydown', onKeyDown, true);
            backdrop.addEventListener('click', onBackdropClick);
            window.setTimeout(() => {
                const focusTarget = initialFocus || getFocusable(box)[0];
                focusTarget?.focus();
                focusTarget?.select?.();
            }, 0);
            return new Promise((resolve) => {
                resolver = resolve;
            });
        }

        return { open, close };
    }

    const renameModal = document.getElementById('rename-artwork-modal');
    const renameInput = document.getElementById('rename-artwork-input');
    const renameConfirm = document.getElementById('rename-artwork-confirm');
    const renameCancel = document.getElementById('rename-artwork-cancel');

    const deleteModal = document.getElementById('delete-artwork-modal');
    const deleteTitle = document.getElementById('delete-artwork-title');
    const deleteConfirm = document.getElementById('delete-artwork-confirm');
    const deleteCancel = document.getElementById('delete-artwork-cancel');

    const renameController = createModalController(renameModal);
    const deleteController = createModalController(deleteModal);

    if (renameController && renameInput && renameConfirm && renameCancel) {
        renameCancel.addEventListener('click', () => renameController.close(null));
        renameConfirm.addEventListener('click', () => {
            const value = renameInput.value.trim();
            renameController.close(value || null);
        });
    }

    if (deleteController && deleteConfirm && deleteCancel) {
        deleteCancel.addEventListener('click', () => deleteController.close(false));
        deleteConfirm.addEventListener('click', () => deleteController.close(true));
    }

    window.EmotionArtDialogs = {
        async promptRename(currentTitle) {
            if (!renameController || !renameInput || !renameConfirm) {
                return window.prompt('Rename artwork', currentTitle);
            }

            renameInput.value = currentTitle || '';
            renameConfirm.disabled = !renameInput.value.trim();

            const syncButtonState = () => {
                renameConfirm.disabled = !renameInput.value.trim();
            };

            renameInput.addEventListener('input', syncButtonState);
            const result = await renameController.open(renameInput);
            renameInput.removeEventListener('input', syncButtonState);
            return result;
        },

        async confirmDelete(title) {
            if (!deleteController || !deleteConfirm) {
                return window.confirm('Delete this artwork from the local gallery folder?');
            }

            if (deleteTitle) {
                deleteTitle.textContent = title || 'this artwork';
            }

            const result = await deleteController.open(deleteConfirm);
            return result === true;
        },

        showToast(message) {
            showToastFallback(message);
        },
    };
})();
