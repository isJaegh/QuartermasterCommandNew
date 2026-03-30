// ============================================================================
// BOTTOM SHEET — Reusable slide-up panel for touch-friendly interactions
// ============================================================================

const SHEET_ID     = 'qmBottomSheet';
const BACKDROP_ID  = 'qmBottomSheetBackdrop';
const SWIPE_THRESHOLD = 80; // px downward drag on handle to auto-dismiss

let _onClose = null;

function ensureDOM() {
    if (document.getElementById(SHEET_ID)) return;

    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'bottom-sheet-backdrop';
    document.body.appendChild(backdrop);

    const sheet = document.createElement('div');
    sheet.id = SHEET_ID;
    sheet.className = 'bottom-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = `
        <div class="bottom-sheet-handle-bar">
            <div class="bottom-sheet-handle"></div>
        </div>
        <div class="bottom-sheet-header">
            <span class="bottom-sheet-title"></span>
            <button class="bottom-sheet-close" aria-label="Close">&times;</button>
        </div>
        <div class="bottom-sheet-body"></div>`;
    document.body.appendChild(sheet);

    sheet.querySelector('.bottom-sheet-close').addEventListener('click', closeSheet);
    backdrop.addEventListener('click', closeSheet);
    attachSwipeDismiss(sheet);
}

function attachSwipeDismiss(sheet) {
    let startY = 0;
    let currentY = 0;
    let tracking = false;

    // Only track swipes that begin on the drag handle bar
    sheet.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.bottom-sheet-handle-bar')) return;
        startY = currentY = e.clientY;
        tracking = true;
        sheet.setPointerCapture(e.pointerId);
        sheet.style.transition = 'none'; // disable CSS transition while dragging
    });

    sheet.addEventListener('pointermove', (e) => {
        if (!tracking) return;
        currentY = e.clientY;
        const delta = Math.max(0, currentY - startY); // downward only
        sheet.style.transform = `translateY(${delta}px)`;
    });

    sheet.addEventListener('pointerup', () => {
        if (!tracking) return;
        tracking = false;
        sheet.style.transition = ''; // restore CSS transition
        if (currentY - startY > SWIPE_THRESHOLD) {
            closeSheet();
        } else {
            sheet.style.transform = 'translateY(0)'; // snap back
        }
    });

    sheet.addEventListener('pointercancel', () => {
        if (!tracking) return;
        tracking = false;
        sheet.style.transition = '';
        sheet.style.transform = 'translateY(0)';
    });
}

export function openBottomSheet({ title = '', html = '', onClose = null } = {}) {
    ensureDOM();
    const sheet    = document.getElementById(SHEET_ID);
    const backdrop = document.getElementById(BACKDROP_ID);

    sheet.querySelector('.bottom-sheet-title').textContent = title;
    sheet.querySelector('.bottom-sheet-body').innerHTML    = html;
    _onClose = onClose;

    // Reset any leftover transform from a prior swipe before animating in
    sheet.style.transform  = '';
    sheet.style.transition = '';

    backdrop.classList.add('open');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden'; // prevent background scroll
}

export function closeSheet() {
    const sheet    = document.getElementById(SHEET_ID);
    const backdrop = document.getElementById(BACKDROP_ID);
    if (!sheet) return;

    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';

    if (typeof _onClose === 'function') {
        _onClose();
        _onClose = null;
    }
}
