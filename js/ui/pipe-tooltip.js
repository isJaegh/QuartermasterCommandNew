// QMCommandWorkingVersion/js/ui/pipe-tooltip.js
// ============================================================================
// PIPELINE ROUTE BUTTON TOOLTIPS
// ============================================================================

import { state } from '../state/store.js';
import { i18n } from '../data/lang.js';
import { getItemName } from '../utils/format.js';
import { EXTRACTION_ROUTES } from '../data/data.js';
import { openModal } from './modals.js';

function isTouchDevice() {
    return (('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0));
}

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
        if (x + tipW > window.innerWidth - 4) x = cx - tipW - margin;
        if (y + tipH > window.innerHeight - 4) y = cy - tipH - margin;
        tip.style.left = Math.max(4, x) + 'px';
        tip.style.top = Math.max(4, y) + 'px';
    }

    document.addEventListener('mouseover', (e) => {
        // Absolutely prevent hover tooltips from triggering on touch devices
        if (isTouchDevice()) {
            tip.style.display = 'none';
            return;
        }

        const btn = e.target.closest('[data-action="changeRoute"]');
        if (!btn) return;
        const stepKey = btn.dataset.step;
        const steps = state.pipelineStepsRaw;
        if (!steps) return;
        const step = steps.find(s => s.stepKey === stepKey);
        if (!step) return;
        const hoveredRoute = btn.dataset.route || '';
        const html = buildPipeDiffHTML(step, hoveredRoute);

        if (!html) {
            tip.style.display = 'none';
            return;
        }

        tip.innerHTML = html;
        tip.style.display = 'block';
        positionTip(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
        if (isTouchDevice()) return;
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

    const sourceAmount = step.inputs?.[0]?.amount || 0;
    const extractionRoutes = step.source ? EXTRACTION_ROUTES[step.source] : null;
    const mainYieldKeys = new Set((step.mainYields || []).map(y => y.item));

    const sourceName = step.source
        ? getItemName(step.source, t)
        : (step.inputs?.[0] ? getItemName(step.inputs[0].item, t) : '');

    let html = `<div class="chart-tip-title">${sourceName} \u2014 Route Comparison</div>`;

    routes.forEach(r => {
        const selClass = r.name === step.selectedRoute ? ' chart-tip-selected' : '';
        const tick = r.name === step.selectedRoute ? '\u2713 ' : '';
        const machine = r.name.split(' (')[0];

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
            const bpItems = [];

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

export function buildPipeDiffHTML(step, hoveredRouteName) {
    const routes = step.routeStats || [];
    if (routes.length === 0) return '';

    const t = i18n[state.currentLang] || i18n['en'];
    const mE = document.getElementById('modExt')?.checked ? 1.03 : 1;
    const mM = document.getElementById('modMast')?.checked ? 1.06 : 1;

    const sourceAmount = step.inputs?.[0]?.amount || 0;
    const extractionRoutes = step.source ? EXTRACTION_ROUTES[step.source] : null;
    const mainYieldKeys = new Set((step.mainYields || []).map(y => y.item));

    const sourceName = step.source
        ? getItemName(step.source, t)
        : (step.inputs?.[0] ? getItemName(step.inputs[0].item, t) : '');

    const hoveredR = routes.find(r => r.name === hoveredRouteName);
    const selectedR = routes.find(r => r.name === step.selectedRoute);

    if (!hoveredR) return buildPipeTipHTML(step);

    const hovMachine = hoveredR.name.split(' (')[0];
    const selMachine = selectedR ? selectedR.name.split(' (')[0] : '';
    const isActive = hoveredR.name === step.selectedRoute;

    if (isActive) return '';

    function computeYields(r) {
        const rd = extractionRoutes?.[r.name];
        if (!rd) return null;
        const mainItems = [], bpItems = [];
        Object.entries(rd.yields).forEach(([yItem, yRate]) => {
            const mod = (yItem === 'bo' && rd.action !== 'stepFurnace' && rd.action !== 'stepBlastFurnace')
                ? mE * mM : mE;
            const amt = Math.floor(sourceAmount * yRate * mod);
            const entry = { key: yItem, name: getItemName(yItem, t), amount: amt };
            if (mainYieldKeys.has(yItem)) mainItems.push(entry);
            else bpItems.push(entry);
        });
        return { mainItems, bpItems, rd };
    }

    const hovYields = computeYields(hoveredR);
    const selYields = selectedR ? computeYields(selectedR) : null;

    function badges(r) {
        let s = '';
        if (r.isBestYield) s += `<span class="chart-tip-badge tip-badge-eff">E</span>`;
        if (r.isMaxYield && !r.isBestYield) s += `<span class="chart-tip-badge tip-badge-max">Y</span>`;
        if (r.isRegionLocked) s += `<span class="chart-tip-badge tip-badge-reg">R</span>`;
        return s;
    }

    function catHtml(r) {
        const rd = extractionRoutes?.[r.name];
        return (rd?.cat && r.catCost > 0)
            ? `<span class="chart-tip-cat"> + ${getItemName(rd.cat, t)} \u00d7${r.catCost.toLocaleString()}</span>`
            : '';
    }

    let html = `<div class="chart-tip-title">${sourceName}</div>`;

    const vsLabel = selMachine ? `<span class="chart-tip-vs">vs \u2713 ${selMachine}</span>` : '';

    html += `<div class="chart-tip-route">`;
    html += `<div class="chart-tip-machine"><strong>${hovMachine}</strong>${badges(hoveredR)}${catHtml(hoveredR)} ${vsLabel}</div>`;

    function renderDiffs(hovItems, selItems, rowCls) {
        const seen = new Set();
        const unified = [];
        (hovItems || []).forEach(it => { seen.add(it.key); unified.push(it.key); });
        (selItems || []).forEach(it => { if (!seen.has(it.key)) unified.push(it.key); });

        let out = '';
        unified.forEach(key => {
            const hov = (hovItems || []).find(i => i.key === key);
            const sel = (selItems || []).find(i => i.key === key);
            const hovAmt = hov?.amount ?? 0;
            const selAmt = sel?.amount ?? 0;
            const delta = hovAmt - selAmt;

            if (delta === 0) return;

            const name = hov?.name || sel?.name || key;
            const sign = delta > 0 ? '+' : '';
            const cls = delta > 0 ? 'tip-delta-pos' : 'tip-delta-neg';
            out += `<div class="chart-tip-item ${rowCls}">` +
                `<span>${name}</span>` +
                `<span class="${cls}">${sign}${delta.toLocaleString()}</span>` +
                `</div>`;
        });
        return out;
    }

    if (hovYields) {
        const mainOut = renderDiffs(hovYields.mainItems, selYields?.mainItems, 'chart-tip-main');
        const bpOut = renderDiffs(hovYields.bpItems, selYields?.bpItems, 'chart-tip-bp');

        if (mainOut) { html += `<div class="chart-tip-section-label">Main yields:</div>` + mainOut; }
        if (bpOut) { html += `<div class="chart-tip-section-label">Byproducts:</div>` + bpOut; }
        if (!mainOut && !bpOut) {
            html += `<div class="chart-tip-section-label" style="font-style:italic;color:var(--text-dim)">No yield differences</div>`;
        }
    } else if (step.mainYields?.length) {
        html += `<div class="chart-tip-section-label" style="font-style:italic;color:var(--text-dim)">Same output as active</div>`;
    }

    html += `</div>`;
    return html;
}

// ─── Mobile: Open the Route Selection Menu Modal ──────────────────────────────

export function showPipeCompare(stepKey) {
    const steps = state.pipelineStepsRaw;
    if (!steps) return;
    const step = steps.find(s => s.stepKey === stepKey);
    if (!step) return;

    const t = i18n[state.currentLang] || i18n['en'];
    const sourceName = step.source
        ? getItemName(step.source, t)
        : (step.inputs?.[0] ? getItemName(step.inputs[0].item, t) : '');

    let html = `<div class="chart-tip-title" style="margin-bottom:12px; font-weight:bold; color:var(--text); font-size:14px;">${sourceName} &mdash; Gains & Losses vs Active</div>`;

    const routes = step.routeStats || [];
    // Only fetch routes that are not currently active
    const nonActiveRoutes = routes.filter(r => r.name !== step.selectedRoute);

    if (nonActiveRoutes.length === 0) {
        html += `<div style="padding:10px 0; color:var(--text-dim); font-style:italic;">No other routes available for comparison.</div>`;
    } else {
        // Generate diffs using the same logic as hover tooltips
        nonActiveRoutes.forEach(r => {
            let diffHtml = buildPipeDiffHTML(step, r.name);
            // Strip out the repeated item title added by buildPipeDiffHTML natively
            diffHtml = diffHtml.replace(/<div class="chart-tip-title">.*?<\/div>/, '');
            html += diffHtml;
        });
    }

    // Safely inject the modal framework if the user hasn't added it to index.html
    let modal = document.getElementById('compareModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'compareModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content module" style="padding: 0; max-width: 450px;">
                <div class="modal-header-sticky">
                    <h3 style="margin:0; color:var(--accent);" id="ui_compareTitle">Route Comparison</h3>
                    <span class="close" data-close="compareModal">&times;</span>
                </div>
                <div class="modal-body-scroll" id="compareModalBody" style="padding: 15px;"></div>
                <div style="padding: 15px; border-top: 1px solid var(--border); text-align: right; background: var(--bg-card);">
                    <button class="btn-dispatch" data-close="compareModal" style="width: auto; display: inline-block; padding: 8px 16px;">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('compareModalBody').innerHTML = html;
    openModal('compareModal');
}