import { saveState } from '../state/store.js';

const defaultColors = {
    dark: { accent: '#d4af37', bg: '#1c1c21', text: '#e0e0e0' },
    light: { accent: '#8a6312', bg: '#ffffff', text: '#111111' }
};

export function toggleTheme() {
    document.body.classList.toggle('light-theme');
    syncThemeSwitch();
    syncColorPickers();
    saveState();
}

function syncThemeSwitch() {
    const cb = document.getElementById('themeToggleCb');
    if (cb) {
        cb.checked = document.body.classList.contains('light-theme');
    }
}

export function applyColors(fromLoad = false) {
    const isLight = document.body.classList.contains('light-theme');
    const themeKey = isLight ? 'light' : 'dark';
    const defs = defaultColors[themeKey];

    let cAccent = document.getElementById('colorAccent')?.value || defs.accent;
    let cBg = document.getElementById('colorBg')?.value || defs.bg;
    let cText = document.getElementById('colorText')?.value || defs.text;

    document.documentElement.style.setProperty('--accent', cAccent);
    document.documentElement.style.setProperty('--bg-card', cBg);
    document.documentElement.style.setProperty('--text', cText);

    const btnReset = document.getElementById('ui_btnResetColors');
    if (btnReset) {
        const isCustom = (cAccent.toLowerCase() !== defs.accent.toLowerCase() ||
            cBg.toLowerCase() !== defs.bg.toLowerCase() ||
            cText.toLowerCase() !== defs.text.toLowerCase());
        btnReset.disabled = !isCustom;
    }

    if (!fromLoad) saveState(); // FIXED: Was incorrectly calling save()
}

export function resetColors() {
    const isLight = document.body.classList.contains('light-theme');
    const themeKey = isLight ? 'light' : 'dark';
    const defs = defaultColors[themeKey];

    if (document.getElementById('colorAccent')) document.getElementById('colorAccent').value = defs.accent;
    if (document.getElementById('colorBg')) document.getElementById('colorBg').value = defs.bg;
    if (document.getElementById('colorText')) document.getElementById('colorText').value = defs.text;

    applyColors();
}

// FIXED: Added 'export' keyword so main.js can use it on boot
export function syncColorPickers() {
    const isLight = document.body.classList.contains('light-theme');
    const themeKey = isLight ? 'light' : 'dark';
    const defs = defaultColors[themeKey];

    // Read the actual computed CSS variables currently applied to the document
    const rootStyles = getComputedStyle(document.documentElement);
    let cAccent = rootStyles.getPropertyValue('--accent').trim() || defs.accent;
    let cBg = rootStyles.getPropertyValue('--bg-card').trim() || defs.bg;
    let cText = rootStyles.getPropertyValue('--text').trim() || defs.text;

    if (document.getElementById('colorAccent')) document.getElementById('colorAccent').value = cAccent;
    if (document.getElementById('colorBg')) document.getElementById('colorBg').value = cBg;
    if (document.getElementById('colorText')) document.getElementById('colorText').value = cText;

    applyColors(true);
}