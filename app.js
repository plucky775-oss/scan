const $ = (selector) => document.querySelector(selector);

const state = {
  pages: [],
  currentPdf: null,
  editingCropPageId: null,
  deferredInstallPrompt: null,
  autoNameEnabled: true,
  cropEditor: {
    img: null,
    points: [],
    scale: 1,
    activeIndex: null,
  },
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
  documentTypeSelect: $('#documentTypeSelect'),
  fileMemoInput: $('#fileMemoInput'),
  fileNameInput: $('#fileNameInput'),
  autoNameBtn: $('#autoNameBtn'),
  makePdfBtn: $('#makePdfBtn'),
  clearPagesBtn: $('#clearPagesBtn'),
  pdfResult: $('#pdfResult'),
  pdfResultName: $('#pdfResultName'),
  pdfResultMeta: $('#pdfResultMeta'),
  previewPdfBtn: $('#previewPdfBtn'),
  sharePdfBtn: $('#sharePdfBtn'),
  downloadPdfBtn: $('#downloadPdfBtn'),
  recentList: $('#recentList'),
  recentSearchInput: $('#recentSearchInput'),
  storageInfo: $('#storageInfo'),
  refreshStorageBtn: $('#refreshStorageBtn'),
  clearOldHistoryBtn: $('#clearOldHistoryBtn'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  cropDialog: $('#cropDialog'),
  cropCanvas: $('#cropCanvas'),
  autoCropBtn: $('#autoCropBtn'),
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
  { id: 'dewrinkle', label: '구김완화' },
];

const QUALITY = {
  high: { maxWidth: 1800, jpeg: 0.92, label: '고화질' },
  normal: { maxWidth: 1400, jpeg: 0.82, label: '일반' },
  small: { maxWidth: 1000, jpeg: 0.68, label: '용량 작게' },
};

function pad(num) {
  return String(num).padStart(2, '0');
}

function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 28);
}

function currentDocumentMeta() {
  return {
    docType: elements.documentTypeSelect?.value || '스캔문서',
    memo: sanitizeFilePart(elements.fileMemoInput?.value || ''),
  };
}

function getDefaultFileName() {
  const now = new Date();
  const { docType, memo } = currentDocumentMeta();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return [docType, memo, date, time].filter(Boolean).join('_');
}

function updateAutoFileName(force = false) {
  if (!force && !state.autoNameEnabled) return;
  elements.fileNameInput.value = getDefaultFileName();
  state.autoNameEnabled = true;
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

function defaultCrop() {
  return {
    type: 'quad',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  };
}

function fullImagePoints(img) {
  return [
    { x: 0, y: 0 },
    { x: img.naturalWidth, y: 0 },
    { x: img.naturalWidth, y: img.naturalHeight },
    { x: 0, y: img.naturalHeight },
  ];
}

function pointsToPercentCrop(points, img) {
  return {
    type: 'quad',
    points: points.map((point) => ({
      x: Math.max(0, Math.min(100, (point.x / img.naturalWidth) * 100)),
      y: Math.max(0, Math.min(100, (point.y / img.naturalHeight) * 100)),
    })),
  };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))];
}

function detectDocumentPoints(img) {
  const maxSide = 520;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  const grays = [];
  for (let i = 0; i < data.length; i += 16) {
    grays.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  const threshold = Math.max(142, percentile(grays, 0.68));
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      const isDocumentLike = gray >= threshold && (saturation < 95 || gray > 205);
      if (!isDocumentLike) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  const area = (maxX - minX) * (maxY - minY);
  const total = width * height;
  if (count < total * 0.08 || area < total * 0.18) return null;

  const padX = width * 0.025;
  const padY = height * 0.025;
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(width - 1, maxX + padX);
  maxY = Math.min(height - 1, maxY + padY);

  const detectedWidth = maxX - minX;
  const detectedHeight = maxY - minY;
  if (detectedWidth < width * 0.32 || detectedHeight < height * 0.32) return null;

  return [
    { x: minX / scale, y: minY / scale },
    { x: maxX / scale, y: minY / scale },
    { x: maxX / scale, y: maxY / scale },
    { x: minX / scale, y: maxY / scale },
  ];
}

function suggestCropPoints(img) {
  return detectDocumentPoints(img) || fullImagePoints(img);
}

function suggestCropPercent(img) {
  return pointsToPercentCrop(suggestCropPoints(img), img);
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
    const suggestedCrop = suggestCropPercent(img) || defaultCrop();
    state.pages.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: file.name || `page-${state.pages.length + 1}.jpg`,
      size: file.size,
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      filter: 'sharp',
      rotation: 0,
      crop: suggestedCrop,
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
            <button class="icon-btn" data-action="crop" data-id="${page.id}">자르기/펼치기</button>
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

function getQuadPoints(page, img) {
  if (page.crop?.type === 'quad' && Array.isArray(page.crop.points) && page.crop.points.length === 4) {
    return page.crop.points.map((point) => ({
      x: Math.max(0, Math.min(img.naturalWidth, img.naturalWidth * (point.x / 100))),
      y: Math.max(0, Math.min(img.naturalHeight, img.naturalHeight * (point.y / 100))),
    }));
  }

  const crop = page.crop || { left: 0, right: 0, top: 0, bottom: 0 };
  const left = img.naturalWidth * ((crop.left || 0) / 100);
  const right = img.naturalWidth * (1 - ((crop.right || 0) / 100));
  const top = img.naturalHeight * ((crop.top || 0) / 100);
  const bottom = img.naturalHeight * (1 - ((crop.bottom || 0) / 100));
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function renderPageToCanvas(page, options = {}) {
  const { maxWidth = 1400 } = options;
  const img = await loadImage(page.dataUrl);
  const quad = getQuadPoints(page, img);
  const baseCanvas = warpQuadToCanvas(img, quad, maxWidth);
  const processed = rotateAndFilterCanvas(baseCanvas, page.rotation, page.filter);

  if (page.filter === 'bw') {
    applyBlackWhite(processed);
  } else if (page.filter === 'sharp') {
    applyMildSharpen(processed);
  } else if (page.filter === 'dewrinkle') {
    applyDocumentClean(processed);
    applyMildSharpen(processed);
  }

  return processed;
}

function warpQuadToCanvas(img, points, maxWidth) {
  const [tl, tr, br, bl] = points;
  const widthTop = distance(tl, tr);
  const widthBottom = distance(bl, br);
  const heightLeft = distance(tl, bl);
  const heightRight = distance(tr, br);
  const sourceWidth = Math.max(20, widthTop, widthBottom);
  const sourceHeight = Math.max(20, heightLeft, heightRight);
  const scale = Math.min(1, maxWidth / sourceWidth);
  const targetWidth = Math.max(20, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(20, Math.round(sourceHeight * scale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;

  const out = document.createElement('canvas');
  out.width = targetWidth;
  out.height = targetHeight;
  const outCtx = out.getContext('2d', { willReadFrequently: true });
  const outImage = outCtx.createImageData(targetWidth, targetHeight);
  const outData = outImage.data;

  const h = homographyFromRectToQuad(targetWidth, targetHeight, points);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const denom = h[6] * x + h[7] * y + 1;
      const sx = (h[0] * x + h[1] * y + h[2]) / denom;
      const sy = (h[3] * x + h[4] * y + h[5]) / denom;
      const srcX = Math.max(0, Math.min(srcCanvas.width - 1, Math.round(sx)));
      const srcY = Math.max(0, Math.min(srcCanvas.height - 1, Math.round(sy)));
      const srcIndex = (srcY * srcCanvas.width + srcX) * 4;
      const outIndex = (y * targetWidth + x) * 4;
      outData[outIndex] = srcData[srcIndex];
      outData[outIndex + 1] = srcData[srcIndex + 1];
      outData[outIndex + 2] = srcData[srcIndex + 2];
      outData[outIndex + 3] = 255;
    }
  }
  outCtx.putImageData(outImage, 0, 0);
  return out;
}

function homographyFromRectToQuad(width, height, points) {
  const src = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const matrix = [];
  const rhs = [];
  for (let i = 0; i < 4; i += 1) {
    const x = src[i].x;
    const y = src[i].y;
    const u = points[i].x;
    const v = points[i].y;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  return solveLinearSystem(matrix, rhs).concat(1);
}

function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => row.concat(rhs[i]));

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0];
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const pivotValue = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function rotateAndFilterCanvas(source, rotation, filter) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotated = normalizedRotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = rotated ? source.height : source.width;
  canvas.height = rotated ? source.width : source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: ['bw', 'sharp', 'dewrinkle'].includes(filter) });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (normalizedRotation) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((normalizedRotation * Math.PI) / 180);
    ctx.translate(-source.width / 2, -source.height / 2);
  }
  ctx.filter = filterToCanvasFilter(filter);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  return canvas;
}

function filterToCanvasFilter(filter) {
  switch (filter) {
    case 'sharp': return 'brightness(1.05) contrast(1.22) saturate(0.95)';
    case 'bright': return 'brightness(1.18) contrast(1.05)';
    case 'contrast': return 'brightness(1.02) contrast(1.38)';
    case 'bw': return 'grayscale(1) contrast(1.35) brightness(1.08)';
    case 'dewrinkle': return 'grayscale(.15) brightness(1.16) contrast(1.25) saturate(.8)';
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

function applyDocumentClean(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const normalized = gray < 120 ? gray * 0.82 : 255 - ((255 - gray) * 0.36);
    const value = Math.max(0, Math.min(255, normalized));
    data[i] = data[i] * 0.25 + value * 0.75;
    data[i + 1] = data[i + 1] * 0.25 + value * 0.75;
    data[i + 2] = data[i + 2] * 0.25 + value * 0.75;
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

  for (let i = 0; i < d.length; i += 4) {
    d[i] = s[i];
    d[i + 1] = s[i + 1];
    d[i + 2] = s[i + 2];
    d[i + 3] = s[i + 3];
  }

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
    const meta = currentDocumentMeta();
    state.currentPdf = {
      fileName,
      blob,
      file,
      url,
      createdAt: new Date().toISOString(),
      pageCount: state.pages.length,
      docType: meta.docType,
      memo: meta.memo,
      quality: quality.label,
    };

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
    docType: pdfItem.docType || '스캔문서',
    memo: pdfItem.memo || '',
    quality: pdfItem.quality || '',
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
  await updateStorageInfo(records);

  const query = (elements.recentSearchInput?.value || '').trim().toLowerCase();
  const filtered = records.filter((record) => {
    if (!query) return true;
    const created = new Date(record.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    return [
      record.fileName,
      record.docType,
      record.memo,
      record.quality,
      created,
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });

  if (!records.length) {
    elements.recentList.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🗂️</div><h3>최근 문서가 없습니다</h3><p>PDF를 생성하면 여기에 저장됩니다.</p></div>`;
    return;
  }

  if (!filtered.length) {
    elements.recentList.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🔎</div><h3>검색 결과가 없습니다</h3><p>다른 파일명, 문서 종류, 날짜로 검색해 주세요.</p></div>`;
    return;
  }

  elements.recentList.innerHTML = filtered.slice(0, 30).map((record) => {
    const created = new Date(record.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    const typeLabel = record.docType || '스캔문서';
    const memo = record.memo ? ` · ${record.memo}` : '';
    const quality = record.quality ? ` · ${record.quality}` : '';
    return `
      <div class="recent-item" data-recent-id="${record.id}">
        <div>
          <div class="recent-item__type">${typeLabel}</div>
          <div class="recent-item__name">${record.fileName}</div>
          <div class="recent-item__meta">${created}${memo} · ${record.pageCount}장 · ${formatBytes(record.size)}${quality}</div>
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

async function updateStorageInfo(records = null) {
  const items = records || await getRecentPdfs();
  const pdfTotal = items.reduce((sum, item) => sum + (item.size || item.blob?.size || 0), 0);
  let usageText = '';
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage) {
        usageText = ` · 브라우저 사용량 ${formatBytes(estimate.usage)}`;
        if (estimate.quota) usageText += ` / ${formatBytes(estimate.quota)}`;
      }
    } catch (error) {
      console.warn(error);
    }
  }
  elements.storageInfo.textContent = `저장된 PDF ${items.length}개 · PDF 용량 ${formatBytes(pdfTotal)}${usageText}`;
}

async function clearOldRecentPdfs() {
  const records = await getRecentPdfs();
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const removeTargets = records
    .slice(20)
    .concat(records.slice(0, 20).filter((record) => now - new Date(record.createdAt).getTime() > thirtyDays));
  const uniqueTargets = [...new Map(removeTargets.map((record) => [record.id, record])).values()];

  if (!uniqueTargets.length) {
    showToast('정리할 오래된 문서가 없습니다.');
    return;
  }

  await Promise.all(uniqueTargets.map((record) => idb('delete', record.id)));
  await renderRecentList();
  showToast(`${uniqueTargets.length}개의 오래된 문서를 정리했습니다.`);
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

async function openCropDialog(page) {
  state.editingCropPageId = page.id;
  elements.cropDialog.showModal();
  showToast('네 모서리를 손가락으로 조정하세요.');
  const img = await loadImage(page.dataUrl);
  state.cropEditor.img = img;
  const quad = getQuadPoints(page, img);
  state.cropEditor.points = quad.map((point) => ({ ...point }));
  state.cropEditor.activeIndex = null;
  drawCropEditor();
}

function drawCropEditor() {
  const { img, points } = state.cropEditor;
  if (!img || points.length !== 4) return;

  const maxWidth = Math.min(680, window.innerWidth - 62);
  const maxHeight = Math.min(Math.max(340, window.innerHeight * 0.62), 720);
  const scale = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1);
  state.cropEditor.scale = scale;

  const canvas = elements.cropCanvas;
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const scaled = points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  ctx.save();
  ctx.fillStyle = 'rgba(47, 128, 237, 0.16)';
  ctx.strokeStyle = '#2f80ed';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(scaled[0].x, scaled[0].y);
  for (let i = 1; i < scaled.length; i += 1) ctx.lineTo(scaled[i].x, scaled[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  scaled.forEach((point, index) => {
    ctx.beginPath();
    ctx.fillStyle = index === state.cropEditor.activeIndex ? '#20c997' : '#ffffff';
    ctx.strokeStyle = '#2f80ed';
    ctx.lineWidth = 4;
    ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function getCanvasPointer(event) {
  const rect = elements.cropCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function nearestCropHandle(pointer) {
  const { points, scale } = state.cropEditor;
  let nearest = null;
  let nearestDistance = Infinity;
  points.forEach((point, index) => {
    const dx = pointer.x - point.x * scale;
    const dy = pointer.y - point.y * scale;
    const dist = Math.hypot(dx, dy);
    if (dist < nearestDistance) {
      nearest = index;
      nearestDistance = dist;
    }
  });
  return nearestDistance <= 46 ? nearest : nearest;
}

function moveCropHandle(event) {
  const { img, scale, activeIndex } = state.cropEditor;
  if (!img || activeIndex === null) return;
  const pointer = getCanvasPointer(event);
  state.cropEditor.points[activeIndex] = {
    x: Math.max(0, Math.min(img.naturalWidth, pointer.x / scale)),
    y: Math.max(0, Math.min(img.naturalHeight, pointer.y / scale)),
  };
  drawCropEditor();
}

function applyCropEditor() {
  const page = pageById(state.editingCropPageId);
  const { img, points } = state.cropEditor;
  if (!page || !img || points.length !== 4) return;
  page.crop = {
    type: 'quad',
    points: points.map((point) => ({
      x: Math.max(0, Math.min(100, (point.x / img.naturalWidth) * 100)),
      y: Math.max(0, Math.min(100, (point.y / img.naturalHeight) * 100)),
    })),
  };
  state.currentPdf = null;
  elements.pdfResult.hidden = true;
  renderPages();
  showToast('문서 영역을 적용했습니다.');
}

function bindEvents() {
  elements.documentTypeSelect.addEventListener('change', () => updateAutoFileName(false));
  elements.fileMemoInput.addEventListener('input', () => updateAutoFileName(false));
  elements.fileNameInput.addEventListener('input', () => {
    state.autoNameEnabled = elements.fileNameInput.value.trim() === '';
  });
  elements.autoNameBtn.addEventListener('click', () => updateAutoFileName(true));

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

  elements.recentSearchInput.addEventListener('input', renderRecentList);
  elements.refreshStorageBtn.addEventListener('click', async () => {
    await renderRecentList();
    showToast('저장공간 정보를 갱신했습니다.');
  });
  elements.clearOldHistoryBtn.addEventListener('click', clearOldRecentPdfs);

  elements.clearHistoryBtn.addEventListener('click', async () => {
    await idb('clear');
    await renderRecentList();
    showToast('최근 문서 목록을 비웠습니다.');
  });

  elements.cropCanvas.addEventListener('pointerdown', (event) => {
    if (!state.cropEditor.img) return;
    event.preventDefault();
    elements.cropCanvas.setPointerCapture(event.pointerId);
    state.cropEditor.activeIndex = nearestCropHandle(getCanvasPointer(event));
    moveCropHandle(event);
  });

  elements.cropCanvas.addEventListener('pointermove', (event) => {
    if (state.cropEditor.activeIndex === null) return;
    event.preventDefault();
    moveCropHandle(event);
  });

  elements.cropCanvas.addEventListener('pointerup', (event) => {
    state.cropEditor.activeIndex = null;
    try { elements.cropCanvas.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    drawCropEditor();
  });

  elements.cropCanvas.addEventListener('pointercancel', () => {
    state.cropEditor.activeIndex = null;
    drawCropEditor();
  });

  elements.autoCropBtn.addEventListener('click', () => {
    const { img } = state.cropEditor;
    if (!img) return;
    state.cropEditor.points = suggestCropPoints(img);
    drawCropEditor();
    showToast('문서 테두리를 추천했습니다. 필요하면 손가락으로 미세 조정하세요.');
  });

  elements.resetCropBtn.addEventListener('click', () => {
    const { img } = state.cropEditor;
    if (!img) return;
    state.cropEditor.points = fullImagePoints(img);
    drawCropEditor();
  });

  elements.applyCropBtn.addEventListener('click', () => {
    applyCropEditor();
  });

  elements.cropDialog.addEventListener('close', () => {
    state.editingCropPageId = null;
    state.cropEditor.img = null;
    state.cropEditor.points = [];
    state.cropEditor.activeIndex = null;
  });

  window.addEventListener('resize', () => {
    if (elements.cropDialog.open) drawCropEditor();
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
