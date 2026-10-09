/**
 * @fileoverview Safe DOM renderer for bounded, read-only answer cards.
 * @module ChatAnswerRenderer
 */

import { validateAnswerCards } from '../utils/answerSchema.js';

const blockSignatures = new WeakMap();
const sourceSignatures = new WeakMap();

function renderSourceItem(source) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = source.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = source.title || source.url;
  item.appendChild(link);
  sourceSignatures.set(item, JSON.stringify(source));
  return item;
}

function appendSources(container, ids, sourcesById) {
  const sources = (Array.isArray(ids) ? ids : []).map((id) => sourcesById.get(id)).filter(Boolean);
  if (!sources.length) return null;
  const list = document.createElement('ul');
  list.className = 'answer-card-sources';
  for (const source of sources) list.appendChild(renderSourceItem(source));
  container.appendChild(list);
  return list;
}

function updateBlockSources(section, block, sourcesById) {
  const container = section.querySelector('.answer-card-summary') || section;
  const oldList = container.querySelector('.answer-card-sources');
  const sources = (block.sourceIds || []).map((id) => sourcesById.get(id)).filter(Boolean);
  if (!sources.length) {
    oldList?.remove();
    return;
  }
  const list = oldList || document.createElement('ul');
  if (!oldList) {
    list.className = 'answer-card-sources';
    container.appendChild(list);
  }
  for (const [index, source] of sources.entries()) {
    const signature = JSON.stringify(source);
    const current = list.children[index];
    if (current && sourceSignatures.get(current) === signature) continue;
    const item = renderSourceItem(source);
    if (current) current.replaceWith(item);
    else list.appendChild(item);
  }
  while (list.children.length > sources.length) list.lastElementChild.remove();
}

function renderBlock(block, sourcesById) {
  const section = document.createElement('section');
  section.className = `answer-card answer-card--${block.type}`;
  if (block.type === 'summary') {
    const details = document.createElement('details');
    details.className = 'answer-card-summary';
    details.open = true;
    const heading = document.createElement('summary');
    heading.textContent = block.title;
    details.appendChild(heading);
    const text = document.createElement('p');
    text.textContent = block.text;
    details.appendChild(text);
    if (block.points.length) {
      const list = document.createElement('ul');
      for (const point of block.points) {
        const item = document.createElement('li');
        item.textContent = point;
        list.appendChild(item);
      }
      details.appendChild(list);
    }
    appendSources(details, block.sourceIds, sourcesById);
    section.appendChild(details);
  } else if (block.type === 'key_values') {
    const heading = document.createElement('h3');
    heading.textContent = block.title;
    section.appendChild(heading);
    const list = document.createElement('dl');
    list.className = 'answer-card-key-values';
    for (const item of block.items) {
      const term = document.createElement('dt');
      term.textContent = item.label;
      const value = document.createElement('dd');
      value.textContent = item.value;
      list.append(term, value);
    }
    section.appendChild(list);
    appendSources(section, block.sourceIds, sourcesById);
  } else if (block.type === 'comparison') {
    const heading = document.createElement('h3');
    heading.textContent = block.title;
    section.appendChild(heading);
    const controls = document.createElement('div');
    controls.className = 'answer-comparison-controls';
    const filter = document.createElement('input');
    filter.className = 'answer-comparison-filter';
    filter.type = 'search';
    filter.setAttribute('aria-label', 'Filter comparison rows');
    filter.placeholder = 'Filter rows';
    const reset = document.createElement('button');
    reset.className = 'answer-comparison-reset';
    reset.type = 'button';
    reset.textContent = 'Reset table';
    controls.append(filter, reset);
    section.appendChild(controls);
    const scroller = document.createElement('div');
    scroller.className = 'answer-card-table-scroll';
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', `${block.title} comparison`);
    const table = document.createElement('table');
    table.className = 'answer-card-comparison';
    let sortColumn = -1;
    let sortDirection = 'ascending';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = [];
    for (const [columnIndex, column] of block.columns.entries()) {
      const header = document.createElement('th');
      header.scope = 'col';
      const sortButton = document.createElement('button');
      sortButton.type = 'button';
      sortButton.className = 'answer-table-sort-button';
      sortButton.textContent = column;
      sortButton.setAttribute('aria-label', `Sort by ${column}`);
      sortButton.addEventListener('click', () => {
        if (sortColumn === columnIndex) {
          sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending';
        } else {
          sortColumn = columnIndex;
          sortDirection = 'ascending';
        }
        for (const candidate of headers) candidate.removeAttribute('aria-sort');
        header.setAttribute('aria-sort', sortDirection);
        sortRows();
      });
      headers.push(header);
      header.appendChild(sortButton);
      headerRow.appendChild(header);
    }
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    const applyFilter = () => {
      const query = filter.value.trim().toLocaleLowerCase();
      for (const row of tbody.rows) {
        row.hidden = Boolean(query && !row.textContent.toLocaleLowerCase().includes(query));
      }
    };
    const sortRows = () => {
      const rows = Array.from(tbody.rows);
      const direction = sortDirection === 'ascending' ? 1 : -1;
      rows.sort((left, right) => {
        if (sortColumn < 0) {
          return Number(left.dataset.originalIndex) - Number(right.dataset.originalIndex);
        }
        const leftText = left.cells[sortColumn]?.textContent || '';
        const rightText = right.cells[sortColumn]?.textContent || '';
        const order = leftText.localeCompare(rightText, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        return order
          ? order * direction
          : Number(left.dataset.originalIndex) - Number(right.dataset.originalIndex);
      });
      for (const [index, row] of rows.entries()) {
        const current = tbody.rows[index];
        if (current !== row) tbody.insertBefore(row, current || null);
      }
      applyFilter();
    };
    for (const [rowIndex, row] of block.rows.entries()) {
      const tr = document.createElement('tr');
      tr.dataset.originalIndex = String(rowIndex);
      row.forEach((cell, index) => {
        const td = document.createElement('td');
        td.dataset.label = block.columns[index] || '';
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    filter.addEventListener('input', applyFilter);
    reset.addEventListener('click', () => {
      filter.value = '';
      sortColumn = -1;
      sortDirection = 'ascending';
      for (const candidate of headers) candidate.removeAttribute('aria-sort');
      sortRows();
      filter.focus();
    });
    scroller.appendChild(table);
    section.appendChild(scroller);
    appendSources(section, block.sourceIds, sourcesById);
  }
  return section;
}

function buildSourcesById(sources) {
  const sourcesById = new Map();
  for (const source of (Array.isArray(sources) ? sources : []).slice(0, 10)) {
    if (!source || typeof source !== 'object') continue;
    const id = typeof source.id === 'string' ? source.id.trim().slice(0, 80) : '';
    const title = typeof source.title === 'string' ? source.title.trim().slice(0, 200) : '';
    const rawUrl = typeof source.url === 'string' ? source.url.trim() : '';
    if (!rawUrl || rawUrl.length > 2048) continue;
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      continue;
    }
    const safeUrl = url.href;
    if (
      !id ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      safeUrl.length > 2048
    ) {
      continue;
    }
    sourcesById.set(id, { id, title, url: safeUrl });
  }
  return sourcesById;
}

/**
 * Reconcile a validated projection into an existing card wrapper. Unchanged
 * blocks keep their DOM nodes, preserving disclosure state, focus, and table
 * controls as progressive prefixes grow.
 * @param {HTMLElement|null} existing
 * @param {*} wire
 * @param {Array} sources
 * @returns {HTMLElement|null}
 */
export function updateAnswerCards(existing, wire, sources = []) {
  const projection = validateAnswerCards(wire, { sources });
  if (!projection || !projection.blocks?.length || typeof document === 'undefined') return null;
  const sourcesById = buildSourcesById(sources);
  const container = existing || document.createElement('div');
  container.className = 'answer-cards';
  container.setAttribute('aria-label', 'Structured answer');
  const oldBlocks = Array.from(container.children);
  const nextBlocks = [];
  for (const block of projection.blocks) {
    const signature = JSON.stringify(block);
    const index = nextBlocks.length;
    let node = oldBlocks[index];
    if (!node || blockSignatures.get(node) !== signature) {
      node = renderBlock(block, sourcesById);
      blockSignatures.set(node, signature);
    } else {
      updateBlockSources(node, block, sourcesById);
    }
    nextBlocks.push(node);
  }
  for (const [index, node] of nextBlocks.entries()) {
    const current = container.children[index];
    if (current === node) continue;
    if (current) current.replaceWith(node);
    else container.appendChild(node);
  }
  while (container.children.length > nextBlocks.length) {
    container.lastElementChild.remove();
  }
  return container;
}

/**
 * Build a visual card tree after revalidating the untrusted terminal payload.
 * Links come only from host-provided grounding metadata and referenced IDs.
 * @param {*} wire
 * @param {Array} sources
 * @returns {HTMLElement|null}
 */
export function renderAnswerCards(wire, sources = []) {
  return updateAnswerCards(null, wire, sources);
}
