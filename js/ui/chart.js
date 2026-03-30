// ============================================================================
// PRODUCTION CHAIN CHART — SVG tree visualization
// ============================================================================

import { state } from '../state/store.js';
import { i18n } from '../data/lang.js';
import { getItemName } from '../utils/format.js';
import { openModal } from './modals.js';
import { EXTRACTION_ROUTES } from '../data/data.js';

const NODE_W  = 170;
const NODE_H  = 58;
const COL_GAP = 200;   // horizontal space between node right-edge and next node left-edge
const ROW_GAP = 30;    // vertical gap between node bottom and next node top

// ─── Public entry point ──────────────────────────────────────────────────────

export function openChartModal() {
    openModal('chartModal');

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
    const { nodes, edges } = buildChartData(steps, t, mE, mM);
    assignLayout(nodes, edges);
    renderSVG(wrapper, nodes, edges);
}

// ─── Data transformation ─────────────────────────────────────────────────────

function buildChartData(steps, t, mE, mM) {
    const nodes = [];
    const edges = [];

    // Maps item key → the most-recently-created output node id for that item
    const itemNodeMap = {};

    // Collect all item keys that appear as outputs of some step
    const allOutputItems = new Set();
    steps.forEach(step => {
        (step.mainYields || []).forEach(y => allOutputItems.add(y.item));
    });

    // Also track the final target (last mainYield of the last step)
    const lastStep = steps[steps.length - 1];
    const targetItem = lastStep && lastStep.mainYields && lastStep.mainYields.length > 0
        ? lastStep.mainYields[lastStep.mainYields.length - 1].item
        : null;

    let nodeIdCounter = 0;
    function makeId() { return `n${nodeIdCounter++}`; }

    steps.forEach((step, stepIndex) => {
        if (!step.inputs || step.inputs.length === 0) return;

        const machineName = (step.selectedRoute || '').split(' (')[0];

        // Build tooltip data for this step's route comparison
        const tooltipData = buildTooltipData(step, t, mE, mM);

        // Resolve or create input nodes
        const resolvedInputIds = step.inputs.map(inp => {
            if (itemNodeMap[inp.item] !== undefined) {
                return itemNodeMap[inp.item];
            }
            // Raw material — not produced by any earlier step
            const nodeId = makeId();
            nodes.push({
                id: nodeId,
                item: inp.item,
                amount: inp.amount,
                label: getItemName(inp.item, t),
                type: 'raw',
                col: 0,
                row: 0
            });
            itemNodeMap[inp.item] = nodeId;
            return nodeId;
        });

        // Create output nodes (mainYields)
        const outputIds = [];
        (step.mainYields || []).forEach(y => {
            const nodeId = makeId();
            const isTarget = (y.item === targetItem && stepIndex === steps.length - 1);
            nodes.push({
                id: nodeId,
                item: y.item,
                amount: y.amount,
                label: getItemName(y.item, t),
                type: isTarget ? 'target' : 'main',
                col: 0,
                row: 0
            });
            itemNodeMap[y.item] = nodeId;
            outputIds.push(nodeId);
        });

        // Edges: each input → each output (label = machine)
        // Only draw label on the primary input edge; catalyst inputs get unlabelled edges
        resolvedInputIds.forEach((fromId, idx) => {
            outputIds.forEach(toId => {
                edges.push({
                    fromId,
                    toId,
                    label: idx === 0 ? machineName : '',
                    isByproduct: false,
                    tooltipData: idx === 0 ? tooltipData : null
                });
            });
        });

        // Byproduct nodes — branch downward from the OUTPUT node (same column as output)
        const bpSourceId = outputIds.length > 0 ? outputIds[0] : resolvedInputIds[0];
        (step.byproducts || []).forEach(y => {
            const bpNodeId = makeId();
            nodes.push({
                id: bpNodeId,
                item: y.item,
                amount: y.amount,
                label: getItemName(y.item, t),
                type: 'byproduct',
                col: 0,
                row: 0,
                bpSourceId
            });
            // Don't overwrite itemNodeMap for byproducts — the item may appear
            // elsewhere in the main chain with a different amount
            edges.push({
                fromId: bpSourceId,
                toId: bpNodeId,
                label: machineName,
                isByproduct: true,
                tooltipData
            });

            // ── Downstream expansion: what can this byproduct produce? ──
            const downRoutes = EXTRACTION_ROUTES[y.item];
            if (downRoutes) {
                const downStats = buildDownstreamRouteStats(y.item, y.amount, mE, mM, downRoutes);
                const chosenName = pickRoute(downStats, state.globalRoutePref);
                if (chosenName) {
                    const chosenRoute = downRoutes[chosenName];
                    const downMachine = chosenName.split(' (')[0];
                    const downTooltip = buildTooltipDataFromStats(
                        getItemName(y.item, t), y.item, y.amount, downStats, chosenName, downRoutes, t, mE, mM
                    );

                    Object.entries(chosenRoute.yields).forEach(([outItem, yRate]) => {
                        const mod = (outItem === 'bo' && chosenRoute.action !== 'stepFurnace' && chosenRoute.action !== 'stepBlastFurnace')
                            ? mE * mM : mE;
                        const outAmount = Math.floor(y.amount * yRate * mod);
                        if (outAmount <= 0) return;

                        const dsNodeId = makeId();
                        nodes.push({
                            id: dsNodeId,
                            item: outItem,
                            amount: outAmount,
                            label: getItemName(outItem, t),
                            type: 'downstream',
                            col: 0,
                            row: 0,
                            bpParentId: bpNodeId
                        });
                        edges.push({
                            fromId: bpNodeId,
                            toId: dsNodeId,
                            label: downMachine,
                            isByproduct: true,
                            isDownstream: true,
                            tooltipData: downTooltip
                        });
                    });
                }
            }
        });
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
            const mod = (yItem === 'bo' && r.action !== 'stepFurnace' && r.action !== 'stepBlastFurnace')
                ? mE * mM : mE;
            totalByproducts += Math.floor(amount * yRate * mod);
        });
        return { name: rName, req: amount, catCost, totalCost, totalByproducts, isRegionLocked, isBestYield: false, isMaxYield: false };
    });

    if (stats.length > 0) {
        const minCost = Math.min(...stats.map(s => s.totalCost));
        const maxBp   = Math.max(...stats.map(s => s.totalByproducts));
        stats.forEach(s => {
            s.isBestYield = s.totalCost === minCost;
            s.isMaxYield  = s.totalByproducts === maxBp && maxBp > 0;
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

function buildTooltipDataFromStats(sourceName, sourceItem, sourceAmount, rows, selectedRoute, allRoutes, t, mE, mM) {
    if (!rows || rows.length === 0) return null;

    // For downstream, all yields are "byproducts" from the downstream source perspective
    // We treat everything as byproducts since there's no main extraction goal here
    const mappedRows = rows.map(r => {
        const badges = [];
        if (r.isBestYield) badges.push({ label: 'E', cls: 'tip-badge-eff' });
        if (r.isMaxYield && !r.isBestYield) badges.push({ label: 'Y', cls: 'tip-badge-max' });
        if (r.isRegionLocked) badges.push({ label: 'R', cls: 'tip-badge-reg' });

        const rd = allRoutes?.[r.name];
        const mainItems = [];
        const bpItems = [];

        if (rd) {
            Object.entries(rd.yields).forEach(([yItem, yRate]) => {
                const mod = (yItem === 'bo' && rd.action !== 'stepFurnace' && rd.action !== 'stepBlastFurnace')
                    ? mE * mM : mE;
                const amt = Math.floor(sourceAmount * yRate * mod);
                // All yields treated as byproducts for downstream nodes
                bpItems.push({ key: yItem, name: getItemName(yItem, t), amount: amt });
            });
        }

        return {
            machine: r.name.split(' (')[0],
            isSelected: r.name === selectedRoute,
            badges,
            mainItems,
            bpItems,
            catCost: r.catCost || 0,
            catItem: rd?.cat || null
        };
    });

    return { title: sourceName, rows: mappedRows };
}

// ─── Tooltip data builder ─────────────────────────────────────────────────────

function buildTooltipData(step, t, mE, mM) {
    const routes = step.routeStats || [];
    if (routes.length === 0) return null;

    const sourceName = step.source
        ? getItemName(step.source, t)
        : (step.inputs && step.inputs[0] ? getItemName(step.inputs[0].item, t) : '');

    const sourceAmount = step.inputs?.[0]?.amount || 0;
    const extractionRoutes = step.source ? EXTRACTION_ROUTES[step.source] : null;
    const mainYieldKeys = new Set((step.mainYields || []).map(y => y.item));

    const rows = routes.map(r => {
        const badges = [];
        if (r.isBestYield) badges.push({ label: 'E', cls: 'tip-badge-eff' });
        if (r.isMaxYield && !r.isBestYield) badges.push({ label: 'Y', cls: 'tip-badge-max' });
        if (r.isRegionLocked) badges.push({ label: 'R', cls: 'tip-badge-reg' });

        const mainItems = [];
        const bpItems = [];

        const rd = extractionRoutes?.[r.name];
        if (rd) {
            Object.entries(rd.yields).forEach(([yItem, yRate]) => {
                const mod = (yItem === 'bo' && rd.action !== 'stepFurnace' && rd.action !== 'stepBlastFurnace')
                    ? mE * mM : mE;
                const amt = Math.floor(sourceAmount * yRate * mod);
                const entry = { key: yItem, name: getItemName(yItem, t), amount: amt };
                if (mainYieldKeys.has(yItem)) mainItems.push(entry);
                else bpItems.push(entry);
            });
        } else {
            // Recipe step — show main output only
            (step.mainYields || []).forEach(y => {
                mainItems.push({ key: y.item, name: getItemName(y.item, t), amount: y.amount });
            });
        }

        return {
            machine: r.name.split(' (')[0],
            isSelected: r.name === step.selectedRoute,
            badges,
            mainItems,
            bpItems,
            catCost: r.catCost || 0,
            catItem: rd?.cat || null
        };
    });

    return { title: sourceName, rows };
}

function renderTooltipHTML(data) {
    if (!data || !data.rows || !data.rows.length) return '';

    let html = `<div class="chart-tip-title">${data.title} \u2014 Route Comparison</div>`;

    data.rows.forEach(r => {
        const selClass = r.isSelected ? ' chart-tip-selected' : '';
        const tick = r.isSelected ? '\u2713 ' : '';
        const badges = r.badges.map(b => `<span class="chart-tip-badge ${b.cls}">${b.label}</span>`).join('');

        html += `<div class="chart-tip-route${selClass}">`;
        html += `<div class="chart-tip-machine">${tick}<strong>${r.machine}</strong>${badges}`;
        if (r.catCost > 0 && r.catItem) {
            html += `<span class="chart-tip-cat"> + ${r.catItem} \u00d7${r.catCost.toLocaleString()}</span>`;
        }
        html += `</div>`;

        if (r.mainItems && r.mainItems.length) {
            html += `<div class="chart-tip-section-label">Main yields:</div>`;
            r.mainItems.forEach(it => {
                html += `<div class="chart-tip-item chart-tip-main"><span>${it.name}</span><span>${it.amount.toLocaleString()}</span></div>`;
            });
        }
        if (r.bpItems && r.bpItems.length) {
            html += `<div class="chart-tip-section-label">Byproducts:</div>`;
            r.bpItems.forEach(it => {
                html += `<div class="chart-tip-item chart-tip-bp"><span>${it.name}</span><span>${it.amount.toLocaleString()}</span></div>`;
            });
        }
        if ((!r.mainItems || !r.mainItems.length) && (!r.bpItems || !r.bpItems.length)) {
            html += `<div class="chart-tip-section-label" style="font-style:italic;">No yield data</div>`;
        }

        html += `</div>`;
    });

    return html;
}

// ─── Layout assignment ────────────────────────────────────────────────────────

function assignLayout(nodes, edges) {
    if (nodes.length === 0) return;

    const nodeById = {};
    nodes.forEach(n => { nodeById[n.id] = n; });

    // Build incoming-edge sets
    const incomingEdges = {};
    nodes.forEach(n => { incomingEdges[n.id] = []; });
    edges.forEach(e => {
        if (incomingEdges[e.toId]) incomingEdges[e.toId].push(e);
    });

    // Build outgoing adjacency (only non-byproduct edges for column propagation)
    const outgoingMain = {};
    nodes.forEach(n => { outgoingMain[n.id] = []; });
    edges.forEach(e => {
        if (!e.isByproduct && outgoingMain[e.fromId]) outgoingMain[e.fromId].push(e.toId);
    });

    // BFS from roots to assign columns (max-depth)
    const rootIds = nodes
        .filter(n => n.type !== 'byproduct' && n.type !== 'downstream' && incomingEdges[n.id].length === 0)
        .map(n => n.id);

    // Initialise columns
    nodes.forEach(n => { n.col = 0; });

    const queue = [...rootIds];
    const visited = new Set(queue);
    while (queue.length > 0) {
        const id = queue.shift();
        const node = nodeById[id];
        (outgoingMain[id] || []).forEach(toId => {
            const toNode = nodeById[toId];
            if (toNode) {
                toNode.col = Math.max(toNode.col, node.col + 1);
                if (!visited.has(toId)) {
                    visited.add(toId);
                    queue.push(toId);
                }
            }
        });
    }

    // Assign byproduct columns = their source node's col (same column as the output node)
    nodes.forEach(n => {
        if (n.type === 'byproduct' && n.bpSourceId) {
            const src = nodeById[n.bpSourceId];
            if (src) n.col = src.col;
        }
    });

    // Assign downstream columns = byproduct parent's col + 1
    nodes.forEach(n => {
        if (n.type === 'downstream' && n.bpParentId) {
            const parent = nodeById[n.bpParentId];
            if (parent) n.col = parent.col + 1;
        }
    });

    // Assign rows: group by column
    const colMainRows = {};
    const colBpRows = {};

    // First pass: count main nodes per column
    const mainCountPerCol = {};
    nodes.forEach(n => {
        if (n.type !== 'byproduct' && n.type !== 'downstream') {
            mainCountPerCol[n.col] = (mainCountPerCol[n.col] || 0) + 1;
        }
    });

    nodes.forEach(n => {
        if (n.type !== 'byproduct' && n.type !== 'downstream') {
            if (colMainRows[n.col] === undefined) colMainRows[n.col] = 0;
            n.row = colMainRows[n.col];
            colMainRows[n.col]++;
        }
    });

    // Byproducts and downstream nodes go below main nodes at their column
    nodes.forEach(n => {
        if (n.type === 'byproduct' || n.type === 'downstream') {
            const mainCount = mainCountPerCol[n.col] || 0;
            if (colBpRows[n.col] === undefined) colBpRows[n.col] = mainCount;
            n.row = colBpRows[n.col];
            colBpRows[n.col]++;
        }
    });
}

// ─── SVG rendering ────────────────────────────────────────────────────────────

function renderSVG(container, nodes, edges) {
    if (nodes.length === 0) return;

    const maxCol = Math.max(...nodes.map(n => n.col));
    const maxRow = Math.max(...nodes.map(n => n.row));

    const svgW = (maxCol + 1) * (NODE_W + COL_GAP) + COL_GAP;
    const svgH = (maxRow + 1) * (NODE_H + ROW_GAP) + ROW_GAP * 2;

    // Compute pixel positions
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

    // ── Draw edges first (below nodes) ──────────────────────────────────────
    edges.forEach(edge => {
        const from = nodeById[edge.fromId];
        const to   = nodeById[edge.toId];
        if (!from || !to) return;

        const sameCol = (from.col === to.col);

        // Path endpoints
        let startX, startY, endX, endY, midX, midY, pathD;

        if (sameCol) {
            // Vertical drop from bottom-centre of source to left-centre of target
            startX = from.x + NODE_W / 2;
            startY = from.y + NODE_H;
            endX   = to.x;
            endY   = to.y + NODE_H / 2;
            const cy = startY + (endY - startY) * 0.5;
            pathD  = `M ${startX},${startY} C ${startX},${cy} ${endX},${endY} ${endX},${endY}`;
            midX   = startX + 16;
            midY   = (startY + endY) / 2;
        } else {
            // Horizontal bezier
            startX = from.x + NODE_W;
            startY = from.y + NODE_H / 2;
            endX   = to.x;
            endY   = to.y + NODE_H / 2;
            const cx = (startX + endX) / 2;
            pathD  = `M ${startX},${startY} C ${cx},${startY} ${cx},${endY} ${endX},${endY}`;
            midX   = (startX + endX) / 2;
            midY   = (startY + endY) / 2 - 2;
        }

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `chart-edge${edge.isByproduct ? ' edge-byproduct' : ''}`);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        if (edge.isByproduct) {
            path.style.stroke = 'var(--warning)';
            path.style.strokeDasharray = '5,3';
            path.style.strokeWidth = '1';
        } else {
            path.style.stroke = 'var(--border)';
            path.style.strokeWidth = '1.5';
        }
        path.style.fill = 'none';
        g.appendChild(path);

        // Machine label at midpoint
        if (edge.label) {
            const labelText = edge.label;
            const approxW = labelText.length * 5.5 + 8;

            const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bgRect.setAttribute('x', midX - approxW / 2);
            bgRect.setAttribute('y', midY - 9);
            bgRect.setAttribute('width', approxW);
            bgRect.setAttribute('height', 13);
            bgRect.setAttribute('rx', '3');
            bgRect.setAttribute('class', 'chart-edge-label-bg');
            bgRect.style.fill = 'var(--bg-main)';
            bgRect.style.opacity = '0.85';
            g.appendChild(bgRect);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', midX);
            text.setAttribute('y', midY);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('class', 'chart-edge-label');
            text.style.fontSize = '9px';
            text.style.fill = 'var(--text-dim)';
            text.style.fontFamily = "'Segoe UI', Tahoma, sans-serif";
            text.style.pointerEvents = 'none';
            text.textContent = labelText;
            g.appendChild(text);

            // Invisible wider hover target over the label area
            if (edge.tooltipData) {
                const hitW = Math.max(approxW + 20, 60);
                const hitH = 24;
                const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hit.setAttribute('x', midX - hitW / 2);
                hit.setAttribute('y', midY - hitH / 2);
                hit.setAttribute('width', hitW);
                hit.setAttribute('height', hitH);
                hit.setAttribute('rx', '3');
                hit.style.fill = 'transparent';
                hit.style.cursor = 'help';
                hit.dataset.tooltipJson = JSON.stringify(edge.tooltipData);
                hit.classList.add('chart-tip-trigger');
                g.appendChild(hit);
            }
        }

        viewport.appendChild(g);
    });

    // ── Draw nodes ────────────────────────────────────────────────────────────
    nodes.forEach(node => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `chart-node node-${node.type}`);
        g.setAttribute('transform', `translate(${node.x},${node.y})`);

        // Background rect
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', NODE_W);
        rect.setAttribute('height', NODE_H);
        rect.setAttribute('rx', '5');
        rect.style.fill = 'var(--bg-card)';
        rect.style.strokeWidth = node.type === 'target' ? '2.5' : '1.5';

        switch (node.type) {
            case 'raw':        rect.style.stroke = 'var(--text-dim)'; break;
            case 'byproduct':  rect.style.stroke = 'var(--warning)';  break;
            case 'target':     rect.style.stroke = 'var(--success)';  break;
            case 'downstream': rect.style.stroke = '#5bc0de';         break;
            default:           rect.style.stroke = 'var(--accent)';   break;
        }
        g.appendChild(rect);

        // Item name (top line)
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

        // Amount (bottom line)
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
            case 'byproduct':  amtText.style.fill = 'var(--warning)'; break;
            case 'target':     amtText.style.fill = 'var(--success)'; break;
            case 'raw':        amtText.style.fill = 'var(--text-dim)'; break;
            case 'downstream': amtText.style.fill = '#5bc0de';        break;
            default:           amtText.style.fill = 'var(--accent)';  break;
        }
        amtText.textContent = (node.amount || 0).toLocaleString();
        g.appendChild(amtText);

        viewport.appendChild(g);
    });

    container.appendChild(svg);
    attachTooltip(container, svg);
    attachZoomPan(svg, viewport);

    // Wire Reset View button (stamp may already be in DOM by now)
    const resetBtn = document.getElementById('btnChartReset');
    if (resetBtn) {
        // Remove previous listener by cloning
        const newBtn = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newBtn, resetBtn);
        newBtn.addEventListener('click', () => {
            viewport.setAttribute('transform', 'translate(0,0) scale(1)');
            _zoom.scale = 1;
            _zoom.tx = 0;
            _zoom.ty = 0;
        });
    }
}

// ─── Tooltip hover logic ─────────────────────────────────────────────────────

function attachTooltip(container, svg) {
    // Append tooltip to body so overflow:hidden on the wrapper doesn't clip it
    let tip = document.getElementById('chartTooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'chartTooltip';
        document.body.appendChild(tip);
    }
    tip.className = 'chart-tooltip';
    // Ensure critical layout styles are always applied even if CSS hasn't reloaded
    tip.style.cssText = [
        'position:fixed',
        'z-index:9999',
        'background:var(--bg-card)',
        'border:1px solid var(--border)',
        'border-radius:6px',
        'padding:10px 12px',
        'max-width:340px',
        'width:max-content',
        'pointer-events:none',
        'box-shadow:0 4px 16px rgba(0,0,0,.5)',
        'font-family:Segoe UI,Tahoma,sans-serif',
        'display:none'
    ].join(';');

    let hideTimer = null;

    function showTip(html, clientX, clientY) {
        clearTimeout(hideTimer);
        tip.innerHTML = html;
        tip.style.display = 'block';
        positionTip(clientX, clientY);
    }

    function hideTip() {
        hideTimer = setTimeout(() => { tip.style.display = 'none'; }, 80);
    }

    function positionTip(clientX, clientY) {
        const tipW = tip.offsetWidth || 280;
        const tipH = tip.offsetHeight || 120;
        const margin = 14;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = clientX + margin;
        let y = clientY + margin;

        if (x + tipW > vw - 4) x = clientX - tipW - margin;
        if (y + tipH > vh - 4) y = clientY - tipH - margin;

        tip.style.left = Math.max(4, x) + 'px';
        tip.style.top  = Math.max(4, y) + 'px';
    }

    // Event delegation on the SVG for tooltip triggers
    svg.addEventListener('mouseover', (e) => {
        const trigger = e.target.closest('.chart-tip-trigger');
        if (!trigger) return;
        const data = JSON.parse(trigger.dataset.tooltipJson || 'null');
        if (!data) return;
        showTip(renderTooltipHTML(data), e.clientX, e.clientY);
    });

    svg.addEventListener('mousemove', (e) => {
        if (tip.style.display === 'none') return;
        if (!e.target.closest('.chart-tip-trigger')) return;
        positionTip(e.clientX, e.clientY);
    });

    svg.addEventListener('mouseout', (e) => {
        if (!e.target.closest('.chart-tip-trigger')) return;
        hideTip();
    });

    // Hide when the modal closes
    const modal = document.getElementById('chartModal');
    if (modal) {
        new MutationObserver(() => {
            if (!modal.classList.contains('open') && modal.style.display === 'none') {
                tip.style.display = 'none';
            }
        }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
    }
}

// ─── Zoom & pan ───────────────────────────────────────────────────────────────

// Module-level zoom state so Reset can access it
const _zoom = { scale: 1, tx: 0, ty: 0 };

function applyTransform(viewport) {
    viewport.setAttribute('transform', `translate(${_zoom.tx},${_zoom.ty}) scale(${_zoom.scale})`);
}

function attachZoomPan(svg, viewport) {
    _zoom.scale = 1;
    _zoom.tx = 0;
    _zoom.ty = 0;

    // Scroll-wheel zoom
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(4, Math.max(0.15, _zoom.scale * delta));

        // Zoom toward mouse position
        _zoom.tx = mouseX - (mouseX - _zoom.tx) * (newScale / _zoom.scale);
        _zoom.ty = mouseY - (mouseY - _zoom.ty) * (newScale / _zoom.scale);
        _zoom.scale = newScale;
        applyTransform(viewport);
    }, { passive: false });

    // Mouse drag pan
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    svg.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        _zoom.tx += e.clientX - lastX;
        _zoom.ty += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        applyTransform(viewport);
    });

    svg.addEventListener('pointerup', () => { dragging = false; });
    svg.addEventListener('pointercancel', () => { dragging = false; });
}
