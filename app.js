const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  pages: [],
  currentPdf: null,
  editingCropPageId: null,
  deferredInstallPrompt: null,
};

const elements = {
  installBtn: $('#installBtn'),
  cameraBtn: $('#cameraBtn'),
  galleryBtn: $('#galleryBtn'),
  cameraInput: $('#cameraInput'),
  galleryInput: $('#galleryInput'),
  pageList: $('#pageList'),
  emptyState: $('#emptyState'),
  pageCountBadge: $('#pageCountBadge'),
  fileNameInput: $('#fileNameInput'),
  makePdfBtn: $('#makePdfBtn'),
  clearPagesBtn: $('#clearPagesBtn'),
  pdfResult: $('#pdfResult'),
  pdfResultName: $('#pdfResultName'),
  pdfResultMeta: $('#pdfResultMeta'),
  previewPdfBtn: $('#previewPdfBtn'),
  sharePdfBtn: $('#sharePdfBtn'),
  downloadPdfBtn: $('#downloadPdfBtn'),
  recentList: $('#recentList'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  cropDialog: $('#cropDialog'),
  cropPreview: $('#cropPreview'),
  cropLeft: $('#cropLeft'),
  cropRight: $('#cropRight'),
  cropTop: $('#cropTop'),
  cropBottom: $('#cropBottom'),
  resetCropBtn: $('#resetCropBtn'),
  applyCropBtn: $('#applyCropBtn'),
  toast: $('#toast'),
};

const FILTERS = [
  { id: 'original', label: '원본' },
  { id: 'sharp', label: '선명' },
  { id: 'bw', label: '흑백' },
  { id: 'bright', label: '밝게' },
  { id: 'contrast', label: '대비' },
];

const QUALITY = {
  high: { maxWidth: 1800, jpeg: 0.92, label: '고화질' },
  normal: { maxWidth: 1400, jpeg: 0.82, label: '일반' },
  small: { maxWidth: 1000, jpeg: 0.68, label: '용량 작게' },
};

function getDefaultFileName() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `스캔문서_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

elements.fileNameInput.value = getDefaultFileName();

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function addFiles(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith('image/'));
  if (!imageFiles.length) {
    showToast('이미지 파일만 추가할 수 있습니다.');
    return;
  }

  for (const file of imageFiles) {
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);
    state.pages.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: file.name || `page-${state.pages.length + 1}.jpg`,
      size: file.size,
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      filter: 'sharp',
      rotation: 0,
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
    });
  }

  state.currentPdf = null;
  elements.pdfResult.hidden = true;
  renderPages();
  showToast(`${imageFiles.length}장을 추가했습니다.`);
}

function renderPages() {
  elements.pageCountBadge.textContent = `${state.pages.length}장`;
  elements.emptyState.hidden = state.pages.length > 0;
  elements.makePdfBtn.disabled = state.pages.length === 0;
  elements.clearPagesBtn.disabled = state.pages.length === 0;

  elements.pageList.innerHTML = state.pages.map((page, index) => {
    const filterButtons = FILTERS.map((filter) => `
      <button class="filter-pill ${page.filter === filter.id ? 'is-active' : ''}" data-action="filter" data-id="${page.id}" data-filter="${filter.id}">${filter.label}</button>
    `).join('');

    return `
      <article class="page-card" data-page-id="${page.id}">
        <canvas class="page-thumb" data-thumb-id="${page.id}" width="232" height="312"></canvas>
        <div class="page-info">
          <div class="page-info__head">
            <div>
              <div class="page-title">${index + 1}페이지</div>
              <div class="page-meta">${page.width}×${page.height}px · ${formatBytes(page.size)}</div>
            </div>
            <button class="icon-btn danger-lite" data-action="delete" data-id="${page.id}">삭제</button>
          </div>
          <div class="filter-row">${filterButtons}</div>
          <div class="action-grid">
            <button class="icon-btn" data-action="rotate" data-id="${page.id}">회전</button>
            <button class="icon-btn" data-action="crop" data-id="${page.id}">자르기</button>
            <button class="icon-btn" data-action="up" data-id="${page.id}" ${index === 0 ? 'disabled' : ''}>위로</button>
            <button class="icon-btn" data-action="down" data-id="${page.id}" ${index === state.pages.length - 1 ? 'disabled' : ''}>아래로</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  for (const page of state.pages) {
    renderThumb(page);
  }
}

async function renderThumb(page) {
  const canvas = document.querySelector(`[data-thumb-id="${page.id}"]`);
  if (!canvas) return;
  const rendered = await renderPageToCanvas(page, { maxWidth: 350 });
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / rendered.width, canvas.height / rendered.height);
  const drawWidth = rendered.width * scale;
  const drawHeight = rendered.height * scale;
  const x = (canvas.width - drawWidth) / 2;
  const y = (canvas.height - drawHeight) / 2;
  ctx.drawImage(rendered, x, y, drawWidth, drawHeight);
}

function getCroppedSourceRect(page, img) {
  const left = img.naturalWidth * (page.crop.left / 100);
  const right = img.naturalWidth * (page.crop.right / 100);
  const top = img.naturalHeight * (page.crop.top / 100);
  const bottom = img.naturalHeight * (page.crop.bottom / 100);
  const sx = left;
  const sy = top;
  const sw = Math.max(10, img.naturalWidth - left - right);
  const sh = Math.max(10, img.naturalHeight - top - bottom);
  return { sx, sy, sw, sh };
}

async function renderPageToCanvas(page, options = {}) {
  const { maxWidth = 1400 } = options;
  const img = await loadImage(page.dataUrl);
  const { sx, sy, sw, sh } = getCroppedSourceRect(page, img);
  const baseScale = Math.min(1, maxWidth / sw);
  const scaledWidth = Math.max(1, Math.round(sw * baseScale));
  const scaledHeight = Math.max(1, Math.round(sh * baseScale));
  const rotated = page.rotation % 180 !== 0;

  const canvas = document.createElement('canvas');
  canvas.width = rotated ? scaledHeight : scaledWidth;
  canvas.height = rotated ? scaledWidth : scaledHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: page.filter === 'bw' });
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (page.rotation) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((page.rotation * Math.PI) / 180);
    ctx.translate(-scaledWidth / 2, -scaledHeight / 2);
  }

  ctx.filter = filterToCanvasFilter(page.filter);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, scaledWidth, scaledHeight);
  ctx.restore();

  if (page.filter === 'bw') {
    applyBlackWhite(canvas);
  } else if (page.filter === 'sharp') {
    applyMildSharpen(canvas);
  }

  return canvas;
}

function filterToCanvasFilter(filter) {
  switch (filter) {
    case 'sharp': return 'brightness(1.05) contrast(1.22) saturate(0.95)';
    case 'bright': return 'brightness(1.18) contrast(1.05)';
    case 'contrast': return 'brightness(1.02) contrast(1.38)';
    case 'bw': return 'grayscale(1) contrast(1.35) brightness(1.08)';
    default: return 'none';
  }
}

function applyBlackWhite(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = gray > 165 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyMildSharpen(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  if (w * h > 3500000) return;
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data;
  const d = dst.data;
  const kernel = [0, -0.25, 0, -0.25, 2, -0.25, 0, -0.25, 0];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let value = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            value += s[((y + ky) * w + (x + kx)) * 4 + c] * kernel[k];
            k += 1;
          }
        }
        d[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, value));
      }
      d[(y * w + x) * 4 + 3] = s[(y * w + x) * 4 + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function pageById(id) {
  return state.pages.find((page) => page.id === id);
}

function selectedQuality() {
  const value = document.querySelector('input[name="quality"]:checked')?.value || 'normal';
  return QUALITY[value];
}

async function makePdf() {
  if (!state.pages.length) return;
  if (!window.jspdf?.jsPDF) {
    showToast('PDF 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    return;
  }

  elements.makePdfBtn.disabled = true;
  elements.makePdfBtn.textContent = 'PDF 생성 중...';

  try {
    const quality = selectedQuality();
    const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;

    for (let i = 0; i < state.pages.length; i += 1) {
      if (i > 0) pdf.addPage();
      const canvas = await renderPageToCanvas(state.pages[i], { maxWidth: quality.maxWidth });
      const imageData = canvas.toDataURL('image/jpeg', quality.jpeg);
      const imgRatio = canvas.width / canvas.height;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2;
      let drawWidth = availableWidth;
      let drawHeight = drawWidth / imgRatio;
      if (drawHeight > availableHeight) {
        drawHeight = availableHeight;
        drawWidth = drawHeight * imgRatio;
      }
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;
      pdf.addImage(imageData, 'JPEG', x, y, drawWidth, drawHeight, undefined, 'FAST');
    }

    const rawName = elements.fileNameInput.value.trim() || getDefaultFileName();
    const fileName = rawName.endsWith('.pdf') ? rawName : `${rawName}.pdf`;
    const blob = pdf.output('blob');
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    state.currentPdf = { fileName, blob, file, url, createdAt: new Date().toISOString(), pageCount: state.pages.length };

    await saveRecentPdf(state.currentPdf);
    renderPdfResult();
    await renderRecentList();
    showToast('PDF를 생성했습니다.');
  } catch (error) {
    console.error(error);
    showToast('PDF 생성 중 오류가 발생했습니다.');
  } finally {
    elements.makePdfBtn.disabled = state.pages.length === 0;
    elements.makePdfBtn.textContent = 'PDF 생성하기';
  }
}

function renderPdfResult() {
  if (!state.currentPdf) return;
  elements.pdfResult.hidden = false;
  elements.pdfResultName.textContent = state.currentPdf.fileName;
  elements.pdfResultMeta.textContent = `${state.currentPdf.pageCount}장 · ${formatBytes(state.currentPdf.blob.size)}`;
}

function downloadBlob(blob, fileName) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sharePdf(pdfItem = state.currentPdf) {
  if (!pdfItem) return;
  const file = pdfItem.file || new File([pdfItem.blob], pdfItem.fileName, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title: pdfItem.fileName, text: '스캔한 PDF 문서입니다.', files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn(error);
    }
  }
  downloadBlob(pdfItem.blob, pdfItem.fileName);
  showToast('공유가 지원되지 않아 파일로 저장했습니다.');
}

function openPdf(pdfItem = state.currentPdf) {
  if (!pdfItem) return;
  const url = pdfItem.url || URL.createObjectURL(pdfItem.blob);
  window.open(url, '_blank', 'noopener,noreferrer');
}

const DB_NAME = 'smart-scan-pwa-db';
const STORE_NAME = 'recent-pdfs';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(method, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, method === 'getAll' ? 'readonly' : 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let req;
    if (method === 'put') req = store.put(value);
    if (method === 'getAll') req = store.getAll();
    if (method === 'delete') req = store.delete(value);
    if (method === 'clear') req = store.clear();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecentPdf(pdfItem) {
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    fileName: pdfItem.fileName,
    blob: pdfItem.blob,
    createdAt: pdfItem.createdAt,
    pageCount: pdfItem.pageCount,
    size: pdfItem.blob.size,
  };
  await idb('put', record);
}

async function getRecentPdfs() {
  try {
    const records = await idb('getAll');
    return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.warn(error);
    return [];
  }
}

async function renderRecentList() {
  const records = await getRecentPdfs();
  if (!records.length) {
    elements.recentList.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🗂️</div><h3>최근 문서가 없습니다</h3><p>PDF를 생성하면 여기에 저장됩니다.</p></div>`;
    return;
  }
  elements.recentList.innerHTML = records.slice(0, 30).map((record) => {
    const created = new Date(record.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <div class="recent-item" data-recent-id="${record.id}">
        <div>
          <div class="recent-item__name">${record.fileName}</div>
          <div class="recent-item__meta">${created} · ${record.pageCount}장 · ${formatBytes(record.size)}</div>
        </div>
        <div class="recent-item__actions">
          <button class="secondary small" data-action="recent-open" data-id="${record.id}">열기</button>
          <button class="primary small" data-action="recent-share" data-id="${record.id}">공유</button>
          <button class="ghost small" data-action="recent-download" data-id="${record.id}">저장</button>
          <button class="danger small" data-action="recent-delete" data-id="${record.id}">삭제</button>
        </div>
      </div>
    `;
  }).join('');
}

async function getRecentRecord(id) {
  const records = await getRecentPdfs();
  const record = records.find((item) => item.id === id);
  if (!record) return null;
  return {
    ...record,
    file: new File([record.blob], record.fileName, { type: 'application/pdf' }),
    url: URL.createObjectURL(record.blob),
  };
}

function openCropDialog(page) {
  state.editingCropPageId = page.id;
  elements.cropLeft.value = page.crop.left;
  elements.cropRight.value = page.crop.right;
  elements.cropTop.value = page.crop.top;
  elements.cropBottom.value = page.crop.bottom;
  updateCropPreview();
  elements.cropDialog.showModal();
}

async function updateCropPreview() {
  const page = pageById(state.editingCropPageId);
  if (!page) return;
  const tempPage = {
    ...page,
    crop: {
      left: Number(elements.cropLeft.value),
      right: Number(elements.cropRight.value),
      top: Number(elements.cropTop.value),
      bottom: Number(elements.cropBottom.value),
    },
  };
  const canvas = await renderPageToCanvas(tempPage, { maxWidth: 700 });
  const preview = elements.cropPreview;
  const ctx = preview.getContext('2d');
  const maxPreviewWidth = Math.min(620, window.innerWidth - 70);
  const scale = Math.min(1, maxPreviewWidth / canvas.width, 480 / canvas.height);
  preview.width = Math.round(canvas.width * scale);
  preview.height = Math.round(canvas.height * scale);
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
}

function bindEvents() {
  elements.cameraBtn.addEventListener('click', () => elements.cameraInput.click());
  elements.galleryBtn.addEventListener('click', () => elements.galleryInput.click());
  elements.cameraInput.addEventListener('change', (event) => addFiles(event.target.files).finally(() => { event.target.value = ''; }));
  elements.galleryInput.addEventListener('change', (event) => addFiles(event.target.files).finally(() => { event.target.value = ''; }));

  elements.pageList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    const index = state.pages.findIndex((page) => page.id === id);
    const page = state.pages[index];
    if (!page) return;

    if (action === 'filter') page.filter = button.dataset.filter;
    if (action === 'rotate') page.rotation = (page.rotation + 90) % 360;
    if (action === 'delete') state.pages.splice(index, 1);
    if (action === 'up' && index > 0) [state.pages[index - 1], state.pages[index]] = [state.pages[index], state.pages[index - 1]];
    if (action === 'down' && index < state.pages.length - 1) [state.pages[index + 1], state.pages[index]] = [state.pages[index], state.pages[index + 1]];
    if (action === 'crop') {
      openCropDialog(page);
      return;
    }

    state.currentPdf = null;
    elements.pdfResult.hidden = true;
    renderPages();
  });

  elements.makePdfBtn.addEventListener('click', makePdf);
  elements.clearPagesBtn.addEventListener('click', () => {
    state.pages = [];
    state.currentPdf = null;
    elements.pdfResult.hidden = true;
    renderPages();
    showToast('스캔 페이지를 모두 삭제했습니다.');
  });

  elements.previewPdfBtn.addEventListener('click', () => openPdf());
  elements.sharePdfBtn.addEventListener('click', () => sharePdf());
  elements.downloadPdfBtn.addEventListener('click', () => state.currentPdf && downloadBlob(state.currentPdf.blob, state.currentPdf.fileName));

  elements.recentList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'recent-delete') {
      await idb('delete', id);
      await renderRecentList();
      showToast('최근 문서를 삭제했습니다.');
      return;
    }
    const record = await getRecentRecord(id);
    if (!record) return;
    if (action === 'recent-open') openPdf(record);
    if (action === 'recent-share') sharePdf(record);
    if (action === 'recent-download') downloadBlob(record.blob, record.fileName);
  });

  elements.clearHistoryBtn.addEventListener('click', async () => {
    await idb('clear');
    await renderRecentList();
    showToast('최근 문서 목록을 비웠습니다.');
  });

  [elements.cropLeft, elements.cropRight, elements.cropTop, elements.cropBottom].forEach((input) => {
    input.addEventListener('input', updateCropPreview);
  });

  elements.resetCropBtn.addEventListener('click', () => {
    elements.cropLeft.value = 0;
    elements.cropRight.value = 0;
    elements.cropTop.value = 0;
    elements.cropBottom.value = 0;
    updateCropPreview();
  });

  elements.applyCropBtn.addEventListener('click', () => {
    const page = pageById(state.editingCropPageId);
    if (!page) return;
    page.crop = {
      left: Number(elements.cropLeft.value),
      right: Number(elements.cropRight.value),
      top: Number(elements.cropTop.value),
      bottom: Number(elements.cropBottom.value),
    };
    state.currentPdf = null;
    elements.pdfResult.hidden = true;
    renderPages();
    showToast('자르기를 적용했습니다.');
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.installBtn.hidden = false;
  });

  elements.installBtn.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    elements.installBtn.hidden = true;
  });
}

async function init() {
  bindEvents();
  renderPages();
  await renderRecentList();
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (error) {
      console.warn('Service worker registration failed', error);
    }
  }
}

init();
