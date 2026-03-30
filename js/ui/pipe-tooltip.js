// ============================================================================
// PIPELINE ROUTE BUTTON TOOLTIPS
// Hover over a machine/route button in the Manufacturing Pipeline to see
// a per-item breakdown of main yields and byproducts for every available route.
// ============================================================================

import { state } from '../state/store.js';
import { i18n } from '../data/lang.js';
import { getItemName } from '../utils/format.js';
import { EXTRACTION_ROUTES } from '../data/data.js';
import { openBottomSheet } from './bottom-sheet.js';

export function initPipeTooltip() {
    let tip = document.getElementById('pipeTip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'pipeTip';
        document.body.appendChild(tip);
    }
    tip.style.cssText = [
        'position:fixed',
        'z-index:9998',
        'background:var(--bg-card)',
        'border:1px solid var(--border)',
        'border-radius:6px',
        'padding:10px 12px',
        'max-width:360px',
        'width:max-content',
        'pointer-events:none',
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'font-family:Segoe UI,Tahoma,sans-serif',
        'font-size:12px',
        'color:var(--text)',
        'display:none'
    ].join(';');

    function positionTip(cx, cy) {
        const tipW = tip.offsetWidth || 280;
        const tipH = tip.offsetHeight || 150;
        const margin = 14;
        let x = cx + margin;
        let y = cy + margin;
        if (x + tipW > window.innerWidth  - 4) x = cx - tipW - margin;
        if (y + tipH > window.innerHeight - 4) y = cy - tipH - margin;
        tip.style.left = Math.max(4, x) + 'px';
        tip.style.top  = Math.max(4, y) + 'px';
    }

    document.addEventListener('mouseover', (e) => {
        const btn = e.target.closest('[data-action="changeRoute"]');
        if (!btn) return;
        const stepKey = btn.dataset.step;
        const steps = state.pipelineStepsRaw;
        if (!steps) return;
        const step = steps.find(s => s.stepKey === stepKey);
        if (!step) return;
        const html = buildPipeTipHTML(step);
        if (!html) return;
        tip.innerHTML = html;
        tip.style.display = 'block';
        positionTip(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
        if (tip.style.display === 'none') return;
        if (!e.target.closest('[data-action="changeRoute"]')) return;
        positionTip(e.clientX, e.clientY);
    });

    document.addEventListener('mouseout', (e) => {
        if (!e.target.closest('[data-action="changeRoute"]')) return;
        tip.style.display = 'none';
    });
}

export function buildPipeTipHTML(step) {
    const routes = step.routeStats || [];
    if (routes.length === 0) return '';

    const t = i18n[state.currentLang] || i18n['en'];
    const mE = document.getElementById('modExt')?.checked ? 1.03 : 1;
    const mM = document.getElementById('modMast')?.checked ? 1.06 : 1;

    const sourceAmount    = step.inputs?.[0]?.amount || 0;
    const extractionRoutes = step.source ? EXTRACTION_ROUTES[step.source] : null;
    const mainYieldKeys   = new Set((step.mainYields || []).map(y => y.item));

    const sourceName = step.source
        ? getItemName(step.source, t)
        : (step.inputs?.[0] ? getItemName(step.inputs[0].item, t) : '');

    let html = `<div class="chart-tip-title">${sourceName} \u2014 Route Comparison</div>`;

    routes.forEach(r => {
        const selClass = r.name === step.selectedRoute ? ' chart-tip-selected' : '';
        const tick     = r.name === step.selectedRoute ? '\u2713 ' : '';
        const machine  = r.name.split(' (')[0];

        const badgeParts = [];
        if (r.isBestYield) badgeParts.push(`<span class="chart-tip-badge tip-badge-eff">E</span>`);
        if (r.isMaxYield && !r.isBestYield) badgeParts.push(`<span class="chart-tip-badge tip-badge-max">Y</span>`);
        if (r.isRegionLocked) badgeParts.push(`<span class="chart-tip-badge tip-badge-reg">R</span>`);

        const rd = extractionRoutes?.[r.name];
        let catHtml = '';
        if (rd?.cat && r.catCost > 0) {
            catHtml = `<span class="chart-tip-cat"> + ${getItemName(rd.cat, t)} \u00d7${r.catCost.toLocaleString()}</span>`;
        }

        html += `<div class="chart-tip-route${selClass}">`;
        html += `<div class="chart-tip-machine">${tick}<strong>${machine}</strong>${badgeParts.join('')}${catHtml}</div>`;

        if (rd) {
            const mainItems = [];
            const bpItems   = [];

            Object.entries(rd.yields).forEach(([yItem, yRate]) => {
                const mod = (yItem === 'bo' && rd.action !== 'stepFurnace' && rd.action !== 'stepBlastFurnace')
                    ? mE * mM : mE;
                const amt = Math.floor(sourceAmount * yRate * mod);
                const entry = { name: getItemName(yItem, t), amount: amt };
                if (mainYieldKeys.has(yItem)) mainItems.push(entry);
                else bpItems.push(entry);
            });

            if (mainItems.length) {
                html += `<div class="chart-tip-section-label">Main yields:</div>`;
                mainItems.forEach(it => {
                    html += `<div class="chart-tip-item chart-tip-main"><span>${it.name}</span><span>${it.amount.toLocaleString()}</span></div>`;
                });
            }
            if (bpItems.length) {
                html += `<div class="chart-tip-section-label">Byproducts:</div>`;
                bpItems.forEach(it => {
                    html += `<div class="chart-tip-item chart-tip-bp"><span>${it.name}</span><span>${it.amount.toLocaleString()}</span></div>`;
                });
            }
        } else {
            // Recipe step — show main outputs only
            if (step.mainYields?.length) {
                html += `<div class="chart-tip-section-label">Output:</div>`;
                step.mainYields.forEach(y => {
                    html += `<div class="chart-tip-item chart-tip-main"><span>${getItemName(y.item, t)}</span><span>${y.amount.toLocaleString()}</span></div>`;
                });
            }
        }

        html += `</div>`;
    });

    return html;
}

// ─── Mobile: open bottom sheet for a step's route comparison ─────────────────

export function showPipeCompare(stepKey) {
    const steps = state.pipelineStepsRaw;
    if (!steps) return;
    const step = steps.find(s => s.stepKey === stepKey);
    if (!step) return;
    const html = buildPipeTipHTML(step);
    if (!html) return;
    openBottomSheet({ title: 'Route Comparison', html });
}
