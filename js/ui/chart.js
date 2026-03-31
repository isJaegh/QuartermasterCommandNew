// QMCommandWorkingVersion/js/ui/chart.js
// ============================================================================
// PRODUCTION CHAIN CHART — SVG tree visualization
// ============================================================================

import { state } from '../state/store.js';
import { i18n } from '../data/lang.js';
import { getItemName } from '../utils/format.js';
import { openModal } from './modals.js';
import { EXTRACTION_ROUTES } from '../data/data.js';
import { openBottomSheet } from './bottom-sheet.js';

const NODE_W = 170;
const NODE_H = 58;
const COL_GAP = 180;
const ROW_GAP = 40;

// ─── Public entry point ──────────────────────────────────────────────────────

export function openChartModal() {
    openModal('chartModal');

    const chkChartBp = document.getElementById('chkChartBp');
    const chkChartSubBp = document.getElementById('chkChartSubBp');
    const lblChartSubBp = document.getElementById('lblChartSubBp');

    if (chkChartBp && !chkChartBp.dataset.bound) {
        chkChartBp.addEventListener('change', (e) => {
            if (chkChartSubBp) chkChartSubBp.disabled = !e.target.checked;
            if (!e.target.checked) {
                if (chkChartSubBp) chkChartSubBp.checked = false;
                if (lblChartSubBp) lblChartSubBp.style.opacity = '0.4';
            } else {
                if (lblChartSubBp) lblChartSubBp.style.opacity = '1';
            }
            refreshChart();
        });
        chkChartBp.dataset.bound = "true";
    }

    if (chkChartSubBp && !chkChartSubBp.dataset.bound) {
        chkChartSubBp.addEventListener('change', refreshChart);
        chkChartSubBp.dataset.bound = "true";
    }

    refreshChart();
}

function refreshChart() {
    const wrapper = document.getElementById('chartSvgWrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const steps = state.pipelineStepsRaw;
    if (!steps || steps.length === 0) {
        wrapper.innerHTML = '<p style="padding:20px; color:var(--text-dim);">No pipeline data. Run a calculation first.</p>';
        return;
    }

    const t = i18n[state.currentLang] || i18n['en'];
    const mE = document.getElementById('modExt')?.checked ? 1.03 : 1;
    const mM = document.getElementById('modMast')?.checked ? 1.06 : 1;

    const showBp = document.getElementById('chkChartBp')?.checked ?? true;
    const showSubBp = document.getElementById('chkChartSubBp')?.checked ?? true;

    const { nodes, edges } = buildChartData(steps, t, mE, mM, showBp, showSubBp);
    assignLayout(nodes, edges);
    renderSVG(wrapper, nodes, edges);
}

// ─── Data transformation ─────────────────────────────────────────────────────

function buildChartData(steps, t, mE, mM, showBp, showSubBp) {
    const nodes = [];
    const edges = [];
    const itemNodeMap = {};

    const lastStep = steps[steps.length - 1];
    const targetItem = lastStep && lastStep.mainYields && lastStep.mainYields.length > 0
        ? lastStep.mainYields[lastStep.mainYields.length - 1].item
        : null;

    let nodeIdCounter = 0;
    function makeId() { return `n${nodeIdCounter++}`; }

    steps.forEach((step, stepIndex) => {
        if (!step.inputs || step.inputs.length === 0) return;

        const machineName = (step.selectedRoute || '').split(' (')[0];
        const tooltipData = buildTooltipData(step, t, mE, mM);

        const resolvedInputIds = step.inputs.map(inp => {
            if (itemNodeMap[inp.item] !== undefined) {
                return itemNodeMap[inp.item];
            }
            const nodeId = makeId();
            nodes.push({
                id: nodeId, item: inp.item, amount: inp.amount,
                label: getItemName(inp.item, t), type: 'raw', col: 0, row: 0
            });
            itemNodeMap[inp.item] = nodeId;
            return nodeId;
        });

        const outputIds = [];
        (step.mainYields || []).forEach(y => {
            const nodeId = makeId();
            const isTarget = (y.item === targetItem && stepIndex === steps.length - 1);
            nodes.push({
                id: nodeId, item: y.item, amount: y.amount,
                label: getItemName(y.item, t), type: isTarget ? 'target' : 'main', col: 0, row: 0
            });
            itemNodeMap[y.item] = nodeId;
            outputIds.push(nodeId);
        });

        resolvedInputIds.forEach((fromId, idx) => {
            outputIds.forEach(toId => {
                edges.push({
                    fromId, toId, label: idx === 0 ? machineName : '',
                    isByproduct: false, tooltipData: idx === 0 ? tooltipData : null
                });
            });
        });

        if (showBp) {
            const bpSourceId = resolvedInputIds.length > 0 ? resolvedInputIds[0] : (outputIds[0] || null);
            (step.byproducts || []).forEach(y => {
                const bpNodeId = makeId();
                nodes.push({
                    id: bpNodeId, item: y.item, amount: y.amount,
                    label: getItemName(y.item, t), type: 'byproduct', col: 0, row: 0, bpSourceId
                });

                // Exclude tooltip from the immediate byproduct edges
                edges.push({
                    fromId: bpSourceId, toId: bpNodeId,
                    label: '',
                    isByproduct: true,
                    tooltipData: null
                });

                if (showSubBp) {
                    const downRoutes = EXTRACTION_ROUTES[y.item];
                    if (downRoutes) {
                        const downStats = buildDownstreamRouteStats(y.item, y.amount, mE, mM, downRoutes);
                        const chosenName = pickRoute(downStats, state.globalRoutePref);

                        if (chosenName) {
                            const chosenRoute = downRoutes[chosenName];
                            const downMachine = chosenName.split(' (')[0];

                            const downTooltip = buildTooltipDataFromStats(
                                getItemName(y.item, t), y.amount, downStats, chosenName, downRoutes, t, mE, mM
                            );

                            Object.entries(chosenRoute.yields).forEach(([outItem, yRate]) => {
                                const mod = (outItem === 'bo' && chosenRoute.action !== 'stepFurnace' && chosenRoute.action !== 'stepBlastFurnace') ? mE * mM : mE;
                                const outAmount = Math.floor(y.amount * yRate * mod);
                                if (outAmount <= 0) return;

                                const dsNodeId = makeId();
                                nodes.push({
                                    id: dsNodeId, item: outItem, amount: outAmount,
                                    label: getItemName(outItem, t), type: 'downstream', col: 0, row: 0, bpParentId: bpNodeId
                                });

                                edges.push({
                                    fromId: bpNodeId, toId: dsNodeId, label: downMachine,
                                    isByproduct: true, isDownstream: true, tooltipData: downTooltip
                                });
                            });
                        }
                    }
                }
            });
        }
    });

    return { nodes, edges };
}

// ─── Downstream route helpers ─────────────────────────────────────────────────

const REGION_LOCKED_KEYWORDS = ['Blast Furnace', 'Fabricula', 'Greater Natorus', 'Natorus', 'Grizzly', 'Hearth'];

function buildDownstreamRouteStats(item, amount, mE, mM, routes) {
    const stats = Object.entries(routes).map(([rName, r]) => {
        const isRegionLocked = REGION_LOCKED_KEYWORDS.some(k => rName.includes(k));
        const catCost = r.cat ? Math.ceil(amount * r.catReq) : 0;
        const totalCost = amount + catCost;
        let totalByproducts = 0;
        Object.entries(r.yields).forEach(([yItem, yRate]) => {
            const mod = (yItem === 'bo' && r.action !== 'stepFurnace' && r.action !== 'stepBlastFurnace') ? mE * mM : mE;
            totalByproducts += Math.floor(amount * yRate * mod);
        });
        return { name: rName, req: amount, catCost, totalCost, totalByproducts, isRegionLocked, isBestYield: false, isMaxYield: false };
    });

    if (stats.length > 0) {
        const minCost = Math.min(...stats.map(s => s.totalCost));
        const maxBp = Math.max(...stats.map(s => s.totalByproducts));
        stats.forEach(s => {
            s.isBestYield = s.totalCost === minCost;
            s.isMaxYield = s.totalByproducts === maxBp && maxBp > 0;
        });
    }
    return stats;
}

function pickRoute(stats, pref) {
    if (!stats || stats.length === 0) return null;
    if (pref === 'yield') {
        const best = stats.find(s => s.isMaxYield);
        return best ? best.name : stats[0].name;
    }
    const best = stats.find(s => s.isBestYield);
    return best ? best.name : stats[0].name;
}

function buildTooltipDataFromStats(sourceName, sourceAmount, rows, selectedRoute, allRoutes, t, mE, mM) {
    if (!rows || rows.length === 0) return null;

    let activeIdx = rows.findIndex(r => r.name === selectedRoute);
    if (activeIdx === -1) activeIdx = 0;

    const mappedRoutes = rows.map((r, idx) => {
        const badges = [];
        if (r.isBestYield) badges.push({ label: 'E', cls: 'tip-badge-eff' });
        if (r.isMaxYield && !r.isBestYield) badges.push({ label: 'Y', cls: 'tip-badge-max' });
        if (r.isRegionLocked) badges.push({ label: 'R', cls: 'tip-badge-reg' });

        const rd = allRoutes?.[r.name];
        const reqAmt = r.req || sourceAmount;
        const bpItems = [];

        if (rd) {
            Object.entries(rd.yields).forEach(([yItem, yRate]) => {
                const mod = (yItem === 'bo' && rd.action !== 'stepFurnace' && rd.action !== 'stepBlastFurnace') ? mE * mM : mE;
                const amt = Math.floor(reqAmt * yRate * mod);
                bpItems.push({ key: yItem, name: getItemName(yItem, t), amount: amt });
            });
        }

        return {
            name: r.name,
            machine: r.name.split(' (')[0],
            isSelected: idx === activeIdx,
            badges,
            catCost: r.catCost || 0,
            catItem: rd?.cat ? getItemName(rd.cat, t) : null,
            reqAmt,
            mainItems: [],
            bpItems
        };
    });

    return {
        stepKey: null, // Readonly marker
        title: sourceName,
        activeIdx,
        routes: mappedRoutes
    };
}

// ─── Interactive Route Selection Tooltip builder ──────────────────────────────

function buildTooltipData(step, t, mE, mM) {
    const routes = step.routeStats || [];
    if (routes.length === 0) return null;

    const sourceName = step.source
        ? getItemName(step.source, t)
        : (step.inputs && step.inputs[0] ? getItemName(step.inputs[0].item, t) : '');

    const sourceAmount = step.inputs?.[0]?.amount || 0;
    const extractionRoutes = step.source ? EXTRACTION_ROUTES[step.source] : null;
    const mainYieldKeys = new Set((step.mainYields || []).map(y => y.item));

    let activeIdx = routes.findIndex(r => r.name === step.selectedRoute);
    if (activeIdx === -1) activeIdx = 0;

    const mappedRoutes = routes.map((r, idx) => {
        const badges = [];
        if (r.isBestYield) badges.push({ label: 'E', cls: 'tip-badge-eff' });
        if (r.isMaxYield && !r.isBestYield) badges.push({ label: 'Y', cls: 'tip-badge-max' });
        if (r.isRegionLocked) badges.push({ label: 'R', cls: 'tip-badge-reg' });

        const rd = extractionRoutes?.[r.name];
        const reqAmt = r.req || sourceAmount;
        const mainItems = [], bpItems = [];

        if (rd) {
            Object.entries(rd.yields).forEach(([yItem, yRate]) => {
                const mod = (yItem === 'bo' && rd.action !== 'stepFurnace' && rd.action !== 'stepBlastFurnace') ? mE * mM : mE;
                const amt = Math.floor(reqAmt * yRate * mod);
                const entry = { key: yItem, name: getItemName(yItem, t), amount: amt };
                if (mainYieldKeys.has(yItem)) mainItems.push(entry);
                else bpItems.push(entry);
            });
        } else {
            (step.mainYields || []).forEach(y => {
                mainItems.push({ key: y.item, name: getItemName(y.item, t), amount: y.amount });
            });
        }

        return {
            name: r.name,
            machine: r.name.split(' (')[0],
            isSelected: idx === activeIdx,
            badges,
            catCost: r.catCost || 0,
            catItem: rd?.cat ? getItemName(rd.cat, t) : null,
            reqAmt,
            mainItems,
            bpItems
        };
    });

    return {
        stepKey: step.stepKey,
        title: sourceName,
        activeIdx,
        routes: mappedRoutes
    };
}

export function renderTooltipHTML(data, viewIdx = 0) {
    if (!data || !data.routes || data.routes.length === 0) return '';

    const total = data.routes.length;
    const safeIdx = ((viewIdx % total) + total) % total;
    const r = data.routes[safeIdx];
    const activeR = data.routes.find(route => route.isSelected) || data.routes[0];

    let html = `<div class="chart-tip-header">`;
    html += `<div class="chart-tip-title">${data.title}</div>`;

    if (total > 1) {
        html += `<div class="chart-tip-nav" style="display:flex; align-items:center;">`;
        html += `<button class="chart-tip-arrow" data-dir="-1" style="background:transparent;border:none;color:var(--text);cursor:pointer;font-size:18px;padding:0 5px;">&#8249;</button>`;
        html += `<span class="chart-tip-nav-label" style="margin: 0 8px;">${safeIdx + 1} / ${total}</span>`;
        html += `<button class="chart-tip-arrow" data-dir="1" style="background:transparent;border:none;color:var(--text);cursor:pointer;font-size:18px;padding:0 5px;">&#8250;</button>`;
        html += `</div>`;
    }
    html += `</div>`;

    const badges = r.badges.map(b => `<span class="chart-tip-badge ${b.cls}">${b.label}</span>`).join('');

    html += `<div class="chart-tip-route ${r.isSelected ? 'chart-tip-selected' : ''}">`;
    html += `<div class="chart-tip-machine">${r.isSelected ? '\u2713 ' : ''}<strong>${r.machine}</strong>${badges}`;
    if (r.catCost > 0 && r.catItem) {
        html += `<span class="chart-tip-cat"> + ${r.catItem} \u00d7${r.catCost.toLocaleString()}</span>`;
    }
    html += `</div>`;

    if (r.reqAmt > 0) {
        const reqDelta = r.reqAmt - activeR.reqAmt;
        const reqSign = reqDelta > 0 ? '+' : '';
        const reqCls = reqDelta < 0 ? 'tip-delta-pos' : reqDelta > 0 ? 'tip-delta-neg' : 'tip-delta-zero';
        const deltaHtml = (!r.isSelected && reqDelta !== 0) ? ` <span class="${reqCls}">(${reqSign}${reqDelta.toLocaleString()})</span>` : '';
        html += `<div class="chart-tip-item chart-tip-main" style="margin-top:4px;"><span>Input Cost</span><span><span style="color:var(--text);">${r.reqAmt.toLocaleString()}</span>${deltaHtml}</span></div>`;
    }

    const renderItems = (items, activeItems, isMain) => {
        const unified = [];
        const seen = new Set();
        items.forEach(it => { seen.add(it.key); unified.push({ ...it }); });
        activeItems.forEach(it => { if (!seen.has(it.key)) unified.push({ ...it, amount: 0 }); });

        unified.forEach(it => {
            if (r.isSelected && it.amount === 0) return;
            const actAmt = activeItems.find(a => a.key === it.key)?.amount || 0;
            const delta = it.amount - actAmt;
            const sign = delta >= 0 ? '+' : '';
            const cls = delta > 0 ? 'tip-delta-pos' : delta < 0 ? 'tip-delta-neg' : 'tip-delta-zero';
            const deltaHtml = (!r.isSelected && delta !== 0) ? ` <span class="${cls}">(${sign}${delta.toLocaleString()})</span>` : '';
            html += `<div class="chart-tip-item ${isMain ? 'chart-tip-main' : 'chart-tip-bp'}"><span>${it.name}</span><span><span style="color:var(--text);">${it.amount.toLocaleString()}</span>${deltaHtml}</span></div>`;
        });
    };

    if (r.mainItems.length > 0 || activeR.mainItems.length > 0) {
        html += `<div class="chart-tip-section-label">Main Yields:</div>`;
        renderItems(r.mainItems, activeR.mainItems, true);
    }
    if (r.bpItems.length > 0 || activeR.bpItems.length > 0) {
        html += `<div class="chart-tip-section-label">Byproducts:</div>`;
        renderItems(r.bpItems, activeR.bpItems, false);
    }

    if (!r.isSelected && data.stepKey) {
        html += `<button class="chart-btn-confirm" data-step="${data.stepKey}" data-route="${r.name}" style="width:100%; margin-top:10px; padding:6px; font-weight:bold; font-size:12px; background:var(--accent); color:var(--bg-main); border:none; border-radius:4px; cursor:pointer;">Confirm Change</button>`;
    } else if (!data.stepKey) {
        html += `<div style="text-align:center; margin-top:10px; font-size:10px; color:var(--text-dim); font-style:italic;">Sub-product preview only</div>`;
    }

    html += `</div>`;
    return html;
}

// ─── Topological Layout Assignment ─────────────────────────────────────────────

function assignLayout(nodes, edges) {
    if (nodes.length === 0) return;

    const nodeById = {};
    nodes.forEach(n => {
        nodeById[n.id] = n;
        n.col = 0;
        n.row = 0;
    });

    const incomingCount = {};
    const outgoingEdges = {};
    nodes.forEach(n => { incomingCount[n.id] = 0; outgoingEdges[n.id] = []; });
    edges.forEach(e => {
        outgoingEdges[e.fromId].push(e.toId);
        incomingCount[e.toId]++;
    });

    const queue = nodes.filter(n => incomingCount[n.id] === 0).map(n => n.id);
    while (queue.length > 0) {
        const currentId = queue.shift();
        const current = nodeById[currentId];

        outgoingEdges[currentId].forEach(toId => {
            const toNode = nodeById[toId];
            toNode.col = Math.max(toNode.col, current.col + 1);
            incomingCount[toId]--;
            if (incomingCount[toId] === 0) queue.push(toId);
        });
    }

    let nextAvailableRow = 0;
    const assignedNodes = new Set();
    const getOutEdges = (id) => edges.filter(e => e.fromId === id);
    const rawNodes = nodes.filter(n => n.type === 'raw');

    rawNodes.forEach(raw => {
        if (assignedNodes.has(raw.id)) return;

        let current = raw;
        const mainLineIds = [];
        const currentBaseRow = nextAvailableRow++;

        while (current) {
            current.row = currentBaseRow;
            assignedNodes.add(current.id);
            mainLineIds.push(current.id);

            const mainOutEdges = getOutEdges(current.id).filter(e => !e.isByproduct);
            if (mainOutEdges.length > 0) {
                const nextId = mainOutEdges[0].toId;
                current = nodeById[nextId];
                if (assignedNodes.has(current.id)) { current = null; }
            } else {
                current = null;
            }
        }

        mainLineIds.forEach(mainId => {
            const bpEdges = getOutEdges(mainId).filter(e => e.isByproduct);
            bpEdges.sort((a, b) => nodeById[a.toId].col - nodeById[b.toId].col);

            bpEdges.forEach(bpEdge => {
                const bpNode = nodeById[bpEdge.toId];
                if (assignedNodes.has(bpNode.id)) return;

                bpNode.row = nextAvailableRow++;
                assignedNodes.add(bpNode.id);

                const subEdges = getOutEdges(bpNode.id);
                subEdges.sort((a, b) => nodeById[a.toId].col - nodeById[b.toId].col);

                subEdges.forEach(subEdge => {
                    const subNode = nodeById[subEdge.toId];
                    if (assignedNodes.has(subNode.id)) return;

                    subNode.row = nextAvailableRow++;
                    assignedNodes.add(subNode.id);
                });
            });
        });
    });

    nodes.forEach(n => {
        if (!assignedNodes.has(n.id)) {
            n.row = nextAvailableRow++;
            assignedNodes.add(n.id);
        }
    });
}

// ─── SVG rendering & Event Binding ────────────────────────────────────────────

function renderSVG(container, nodes, edges) {
    if (nodes.length === 0) return;

    const maxCol = Math.max(...nodes.map(n => n.col));
    const maxRow = Math.max(...nodes.map(n => n.row));

    const svgW = (maxCol + 1) * (NODE_W + COL_GAP) + COL_GAP;
    const svgH = (maxRow + 1) * (NODE_H + ROW_GAP) + ROW_GAP * 2;

    const nodeById = {};
    nodes.forEach(n => {
        n.x = COL_GAP / 2 + n.col * (NODE_W + COL_GAP);
        n.y = ROW_GAP + n.row * (NODE_H + ROW_GAP);
        nodeById[n.id] = n;
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.style.display = 'block';

    const viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    viewport.setAttribute('id', 'chart-viewport');
    svg.appendChild(viewport);

    // Render Edges
    edges.forEach(edge => {
        const from = nodeById[edge.fromId];
        const to = nodeById[edge.toId];
        if (!from || !to) return;

        const startX = from.x + NODE_W;
        const startY = from.y + NODE_H / 2;
        const endX = to.x;
        const endY = to.y + NODE_H / 2;

        const cx = (startX + endX) / 2;
        const pathD = `M ${startX},${startY} C ${cx},${startY} ${cx},${endY} ${endX},${endY}`;
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2 - 2;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `chart-edge${edge.isByproduct ? ' edge-byproduct' : ''}`);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);

        if (edge.isByproduct) {
            path.style.stroke = 'var(--warning)';
            path.style.strokeDasharray = '5,3';
            path.style.strokeWidth = '1';
        } else {
            path.style.stroke = 'var(--success)';
            path.style.strokeWidth = '2.5';
        }
        path.style.fill = 'none';
        g.appendChild(path);

        edge.dom = { path };

        if (edge.label) {
            const hasAlts = (edge.tooltipData && edge.tooltipData.routes.length > 1);
            const labelText = hasAlts ? edge.label + ' \u25BE' : edge.label;
            const approxW = labelText.length * 5.5 + 8;

            const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bgRect.setAttribute('x', midX - approxW / 2);
            bgRect.setAttribute('y', midY - 9);
            bgRect.setAttribute('width', approxW);
            bgRect.setAttribute('height', 13);
            bgRect.setAttribute('rx', '3');
            bgRect.setAttribute('class', 'chart-edge-label-bg');
            bgRect.style.fill = 'var(--bg-main)';
            bgRect.style.opacity = '0.9';
            bgRect.style.pointerEvents = 'none';
            g.appendChild(bgRect);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', midX);
            text.setAttribute('y', midY);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('class', 'chart-edge-label');
            text.style.fontSize = '9px';
            text.style.fontWeight = edge.isByproduct ? 'normal' : 'bold';
            text.style.fill = edge.isByproduct ? 'var(--text-dim)' : 'var(--text)';
            text.style.fontFamily = "'Segoe UI', Tahoma, sans-serif";
            text.style.pointerEvents = 'none';
            text.textContent = labelText;
            g.appendChild(text);

            edge.dom.bgRect = bgRect;
            edge.dom.text = text;

            if (edge.tooltipData) {
                const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
                const hitW = Math.max(approxW + 20, isTouch ? 80 : 60);
                const hitH = isTouch ? 44 : 24;
                const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hit.setAttribute('x', midX - hitW / 2);
                hit.setAttribute('y', midY - hitH / 2);
                hit.setAttribute('width', hitW);
                hit.setAttribute('height', hitH);
                hit.setAttribute('rx', '3');
                hit.style.fill = 'transparent';
                hit.style.cursor = 'pointer';
                hit.style.pointerEvents = 'auto';
                hit.dataset.tooltipJson = JSON.stringify(edge.tooltipData);
                hit.classList.add('chart-tip-trigger');
                if (isTouch) hit.classList.add('chart-tip-trigger-touch');
                g.appendChild(hit);

                edge.dom.hit = hit;
            }
        }
        viewport.appendChild(g);
    });

    // Render Nodes 
    nodes.forEach(node => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `chart-node node-${node.type}`);
        g.setAttribute('transform', `translate(${node.x},${node.y})`);
        g.style.cursor = 'grab';

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', NODE_W);
        rect.setAttribute('height', NODE_H);
        rect.setAttribute('rx', '5');
        rect.style.fill = 'var(--bg-card)';
        rect.style.strokeWidth = '2';

        switch (node.type) {
            case 'raw':
            case 'main':
            case 'target': rect.style.stroke = 'var(--success)'; break;
            case 'byproduct': rect.style.stroke = 'var(--warning)'; break;
            case 'downstream': rect.style.stroke = '#5bc0de'; break;
            default: rect.style.stroke = 'var(--accent)'; break;
        }
        g.appendChild(rect);

        const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nameText.setAttribute('x', NODE_W / 2);
        nameText.setAttribute('y', NODE_H / 2 - 8);
        nameText.setAttribute('text-anchor', 'middle');
        nameText.setAttribute('dominant-baseline', 'middle');
        nameText.setAttribute('class', 'node-name');
        nameText.style.fontSize = '11px';
        nameText.style.fontWeight = 'bold';
        nameText.style.fill = 'var(--text)';
        nameText.style.fontFamily = "'Segoe UI', Tahoma, sans-serif";
        nameText.style.pointerEvents = 'none';
        nameText.textContent = node.label;
        g.appendChild(nameText);

        const amtText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        amtText.setAttribute('x', NODE_W / 2);
        amtText.setAttribute('y', NODE_H / 2 + 10);
        amtText.setAttribute('text-anchor', 'middle');
        amtText.setAttribute('dominant-baseline', 'middle');
        amtText.setAttribute('class', 'node-amount');
        amtText.style.fontSize = '10px';
        amtText.style.pointerEvents = 'none';
        amtText.style.fontFamily = "'Segoe UI', Tahoma, sans-serif";

        switch (node.type) {
            case 'byproduct': amtText.style.fill = 'var(--warning)'; break;
            case 'target':
            case 'raw':
            case 'main': amtText.style.fill = 'var(--success)'; break;
            case 'downstream': amtText.style.fill = '#5bc0de'; break;
            default: amtText.style.fill = 'var(--accent)'; break;
        }
        amtText.textContent = (node.amount || 0).toLocaleString();
        g.appendChild(amtText);

        viewport.appendChild(g);

        node.dom = { rect, group: g };
        attachNodeDrag(node, edges, nodeById);
    });

    container.appendChild(svg);
    attachTooltip(container, svg, nodes, edges, nodeById);
    attachZoomPan(svg, viewport);

    const resetBtn = document.getElementById('btnChartReset');
    if (resetBtn) {
        const newBtn = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newBtn, resetBtn);
        newBtn.addEventListener('click', () => {
            viewport.setAttribute('transform', 'translate(0,0) scale(1)');
            _zoom.scale = 1;
            _zoom.tx = 0;
            _zoom.ty = 0;
            refreshChart();
        });
    }
}

// ─── Fast Drag Logic for Individual Nodes ─────────────────────────────────────

function attachNodeDrag(node, edges, nodeById) {
    let isDragging = false;
    let startMouseX, startMouseY, initNodeX, initNodeY;
    let rafId = null;

    node.dom.group.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.stopPropagation();

        isDragging = true;
        node.dom.group.style.cursor = 'grabbing';
        node.dom.group.setPointerCapture(e.pointerId);

        startMouseX = e.clientX;
        startMouseY = e.clientY;
        initNodeX = node.x;
        initNodeY = node.y;
    });

    node.dom.group.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        const dragSpeed = 2.0; 
        const dx = ((e.clientX - startMouseX) / _zoom.scale) * dragSpeed;
        const dy = ((e.clientY - startMouseY) / _zoom.scale) * dragSpeed;

        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                node.x = initNodeX + dx;
                node.y = initNodeY + dy;

                node.dom.group.setAttribute('transform', `translate(${node.x},${node.y})`);
                updateEdgesForNode(node.id, edges, nodeById);
                
                rafId = null;
            });
        }
    });

    const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        node.dom.group.style.cursor = 'grab';
        node.dom.group.releasePointerCapture(e.pointerId);
    };

    node.dom.group.addEventListener('pointerup', endDrag);
    node.dom.group.addEventListener('pointercancel', endDrag);
}

// ─── Dynamic Wire Routing ─────────────────────────────────────────────────────

function updateEdgesForNode(nodeId, edges, nodeById) {
    edges.forEach(edge => {
        if (edge.fromId === nodeId || edge.toId === nodeId) {
            const from = nodeById[edge.fromId];
            const to = nodeById[edge.toId];

            const startX = from.x + NODE_W;
            const startY = from.y + NODE_H / 2;
            const endX = to.x;
            const endY = to.y + NODE_H / 2;

            const cx = (startX + endX) / 2;
            const pathD = `M ${startX},${startY} C ${cx},${startY} ${cx},${endY} ${endX},${endY}`;
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2 - 2;

            if (edge.dom.path) {
                edge.dom.path.setAttribute('d', pathD);
            }
            if (edge.dom.bgRect) {
                const approxW = parseFloat(edge.dom.bgRect.getAttribute('width'));
                edge.dom.bgRect.setAttribute('x', midX - approxW / 2);
                edge.dom.bgRect.setAttribute('y', midY - 9);
            }
            if (edge.dom.text) {
                edge.dom.text.setAttribute('x', midX);
                edge.dom.text.setAttribute('y', midY);
            }
            if (edge.dom.hit) {
                const hitW = parseFloat(edge.dom.hit.getAttribute('width'));
                const hitH = parseFloat(edge.dom.hit.getAttribute('height'));
                edge.dom.hit.setAttribute('x', midX - hitW / 2);
                edge.dom.hit.setAttribute('y', midY - hitH / 2);
            }
        }
    });
}

// ─── Tooltip hover & Highlight Linkage ────────────────────────────────────────

function attachTooltip(container, svg, nodes, edges, nodeById) {
    let tip = document.getElementById('chartTooltip');

    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'chartTooltip';
        document.body.appendChild(tip);

        tip.className = 'chart-tooltip';
        tip.style.cssText = [
            'position:fixed', 'z-index:9999', 'background:var(--bg-card)',
            'border:2px solid var(--border)', 'border-radius:6px',
            'padding:10px 12px', 'max-width:340px', 'width:max-content',
            'pointer-events:auto', 'box-shadow:0 4px 16px rgba(0,0,0,.5)',
            'font-family:Segoe UI,Tahoma,sans-serif', 'display:none',
            'transition: border-color 0.2s, box-shadow 0.2s'
        ].join(';');

        tip.addEventListener('click', (e) => {
            e.stopPropagation();

            const arrow = e.target.closest('.chart-tip-arrow');
            if (arrow && tip._data) {
                const dir = parseInt(arrow.dataset.dir, 10);
                const total = tip._data.routes.length;
                tip._idx = ((tip._idx + dir) % total + total) % total;
                tip.innerHTML = renderTooltipHTML(tip._data, tip._idx);
                return;
            }

            const confirmBtn = e.target.closest('.chart-btn-confirm');
            if (confirmBtn && window.updatePathChoice) {
                const stepKey = confirmBtn.dataset.step;
                const routeName = confirmBtn.dataset.route;

                window.updatePathChoice(null, stepKey, routeName);

                setTimeout(() => refreshChart(), 50);

                clearHighlights();
                tip.style.display = 'none';
                tip._data = null;
                return;
            }
        });

        document.addEventListener('click', (e) => {
            if (tip.style.display !== 'none' && !tip.contains(e.target) && !e.target.closest('.chart-tip-trigger')) {
                clearHighlights();
                tip.style.display = 'none';
                tip._data = null;
            }
        });

        const modal = document.getElementById('chartModal');
        if (modal) {
            new MutationObserver(() => {
                if (!modal.classList.contains('open') && modal.style.display === 'none') {
                    clearHighlights();
                    tip.style.display = 'none';
                    tip._data = null;
                }
            }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
        }
    }

    function clearHighlights() {
        document.querySelectorAll('.chart-active-highlight').forEach(el => {
            el.classList.remove('chart-active-highlight');
            el.style.stroke = el.dataset.origStroke;
            el.style.strokeWidth = el.dataset.origStrokeWidth;
            el.style.filter = 'none';
        });
    }

    function highlightElement(el, color) {
        if (!el) return;
        el.classList.add('chart-active-highlight');
        if (!el.dataset.origStroke) {
            el.dataset.origStroke = el.style.stroke;
            el.dataset.origStrokeWidth = el.style.strokeWidth;
        }
        el.style.stroke = color;
        el.style.strokeWidth = '3px';
        el.style.filter = `drop-shadow(0 0 6px ${color}80)`;
    }

    function showTip(data, clientX, clientY) {
        tip._data = data;
        tip._idx = data.activeIdx || 0;
        tip.innerHTML = renderTooltipHTML(data, tip._idx);
        tip.style.display = 'block';

        clearHighlights();
        if (data.stepKey) {
            const highlightColor = '#b388ff';
            tip.style.borderColor = highlightColor;
            tip.style.boxShadow = `0 0 18px ${highlightColor}60`;

            edges.forEach(edge => {
                if (edge.tooltipData && edge.tooltipData.stepKey === data.stepKey) {
                    highlightElement(edge.dom.path, highlightColor);
                    const fromNode = nodeById[edge.fromId];
                    const toNode = nodeById[edge.toId];
                    if (fromNode && fromNode.dom.rect) highlightElement(fromNode.dom.rect, highlightColor);
                    if (toNode && toNode.dom.rect) highlightElement(toNode.dom.rect, highlightColor);
                }
            });
        } else {
            tip.style.borderColor = 'var(--border)';
            tip.style.boxShadow = '0 4px 16px rgba(0,0,0,.5)';
        }

        const tipW = tip.offsetWidth || 280;
        const tipH = tip.offsetHeight || 120;
        const margin = 14;
        let x = clientX + margin;
        let y = clientY + margin;

        if (x + tipW > window.innerWidth - 4) x = clientX - tipW - margin;
        if (y + tipH > window.innerHeight - 4) y = clientY - tipH - margin;

        tip.style.left = Math.max(4, x) + 'px';
        tip.style.top = Math.max(4, y) + 'px';
    }

    svg.addEventListener('click', (e) => {
        const trigger = e.target.closest('.chart-tip-trigger');
        if (trigger) {
            const data = JSON.parse(trigger.dataset.tooltipJson || 'null');
            if (!data) return;

            if (trigger.classList.contains('chart-tip-trigger-touch')) {
                clearHighlights();
                tip.style.display = 'none';
                tip._data = null;
                openBottomSheet({ title: data.title || 'Route Data', html: renderTooltipHTML(data, data.activeIdx || 0) });
                return;
            }

            e.stopPropagation();
            showTip(data, e.clientX, e.clientY);
            return;
        }

        clearHighlights();
        tip.style.display = 'none';
        tip._data = null;
    });
}

// ─── Zoom & pan ───────────────────────────────────────────────────────────────

const _zoom = { scale: 1, tx: 0, ty: 0 };

function applyTransform(viewport) {
    viewport.setAttribute('transform', `translate(${_zoom.tx},${_zoom.ty}) scale(${_zoom.scale})`);
}

function attachZoomPan(svg, viewport) {
    _zoom.scale = 1;
    _zoom.tx = 0;
    _zoom.ty = 0;

    svg.style.touchAction = 'none';

    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        // Increased max zoom capability from 4 to 8
        const newScale = Math.min(8, Math.max(0.15, _zoom.scale * delta));

        _zoom.tx = mouseX - (mouseX - _zoom.tx) * (newScale / _zoom.scale);
        _zoom.ty = mouseY - (mouseY - _zoom.ty) * (newScale / _zoom.scale);
        _zoom.scale = newScale;
        applyTransform(viewport);
    }, { passive: false });

    const activePointers = new Map();
    let rafId = null;

    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;

        if (e.target.closest('.chart-tip-trigger') || e.target.closest('.chart-node')) {
            return;
        }

        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    svg.addEventListener('pointermove', (e) => {
        if (!activePointers.has(e.pointerId)) return;

        const prev = activePointers.get(e.pointerId);
        const curr = { x: e.clientX, y: e.clientY };

        if (!rafId) {
            rafId = requestAnimationFrame(() => {
                
                if (activePointers.size === 1) {
                    const panSpeed = 2.0; 
                    _zoom.tx += (curr.x - prev.x) * panSpeed;
                    _zoom.ty += (curr.y - prev.y) * panSpeed;
                    
                    applyTransform(viewport);
                    activePointers.set(e.pointerId, curr);
                    
                } else if (activePointers.size === 2) {
                    const pts = Array.from(activePointers.values());
                    const p1 = pts[0];
                    const p2 = pts[1];
                    
                    const prevDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    const prevMidX = (p1.x + p2.x) / 2;
                    const prevMidY = (p1.y + p2.y) / 2;

                    activePointers.set(e.pointerId, curr);

                    const newPts = Array.from(activePointers.values());
                    const np1 = newPts[0];
                    const np2 = newPts[1];

                    const newDist = Math.hypot(np2.x - np1.x, np2.y - np1.y);
                    const newMidX = (np1.x + np2.x) / 2;
                    const newMidY = (np1.y + np2.y) / 2;

                    const pinchPanSpeed = 1.0;
                    _zoom.tx += (newMidX - prevMidX) * pinchPanSpeed;
                    _zoom.ty += (newMidY - prevMidY) * pinchPanSpeed;

                    if (prevDist > 0) {
                        const rect = svg.getBoundingClientRect();
                        const midX = newMidX - rect.left;
                        const midY = newMidY - rect.top;

                        const scaleFactor = newDist / prevDist;
                        // Increased max zoom capability from 4 to 8
                        const newScale = Math.min(8, Math.max(0.15, _zoom.scale * scaleFactor));

                        _zoom.tx = midX - (midX - _zoom.tx) * (newScale / _zoom.scale);
                        _zoom.ty = midY - (midY - _zoom.ty) * (newScale / _zoom.scale);
                        _zoom.scale = newScale;
                    }

                    applyTransform(viewport);
                }
                
                rafId = null;
            });
        } else {
            activePointers.set(e.pointerId, curr);
        }
    });

    const endPointer = (e) => {
        activePointers.delete(e.pointerId);
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };

    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    
    svg.addEventListener('pointerout', (e) => {
        if (!svg.contains(e.relatedTarget)) {
            endPointer(e);
        }
    });
}