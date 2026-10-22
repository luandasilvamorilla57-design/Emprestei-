type ReceiptField = { label: string; value: string; wide: boolean };
type ReceiptVisualData = {
  title: string;
  number: string;
  client: string;
  fields: ReceiptField[];
  highlightLabel: string;
  highlightValue: string;
  disclaimer: string;
};

function visualText(root: ParentNode, selector: string, fallback = '') {
  return root.querySelector(selector)?.textContent?.trim() || fallback;
}

function readReceiptModal(modal: HTMLElement): ReceiptVisualData {
  const fields = Array.from(modal.querySelectorAll<HTMLElement>('.receipt-field')).map((field) => ({
    label: visualText(field, 'span'),
    value: visualText(field, 'strong'),
    wide: field.classList.contains('wide'),
  }));

  return {
    title: visualText(modal, '.receipt-type-line strong', 'Comprovante digital'),
    number: visualText(modal, '.receipt-number', 'EMP-DIGITAL'),
    client: visualText(modal, '.receipt-client strong', 'Cliente'),
    fields,
    highlightLabel: visualText(modal, '.receipt-highlight span', 'Valor'),
    highlightValue: visualText(modal, '.receipt-highlight strong', 'R$ 0,00'),
    disclaimer: visualText(modal, '.receipt-disclaimer', 'Comprovante de controle interno, sem valor fiscal.'),
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let currentY = y;
  let lines = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      currentY += lineHeight;
      lines += 1;
      line = word;
      if (lines >= maxLines - 1) {
        const rest = [line, ...words.slice(index + 1)].join(' ');
        let clipped = rest;
        while (clipped.length > 4 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
        ctx.fillText(`${clipped}…`, x, currentY);
        return currentY + lineHeight;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, currentY);
  return currentY + lineHeight;
}

function drawField(ctx: CanvasRenderingContext2D, field: ReceiptField, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = '#f5f8fb';
  roundedRect(ctx, x, y, width, height, 28);
  ctx.fill();

  ctx.fillStyle = '#8194a5';
  ctx.font = '800 18px Arial, sans-serif';
  ctx.letterSpacing = '1px';
  ctx.fillText(field.label.toUpperCase(), x + 28, y + 42);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#0d1d2b';
  ctx.font = '800 29px Arial, sans-serif';
  wrapCanvasText(ctx, field.value, x + 28, y + 88, width - 56, 35, 2);
}

function buildReceiptCanvas(data: ReceiptVisualData) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1540;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível gerar o comprovante.');

  ctx.fillStyle = '#edf4f1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.shadowColor = 'rgba(20, 44, 60, .14)';
  ctx.shadowBlur = 38;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, 54, 42, 972, 1454, 54);
  ctx.fill();
  ctx.restore();

  const brandGradient = ctx.createLinearGradient(82, 80, 998, 340);
  brandGradient.addColorStop(0, '#10a76c');
  brandGradient.addColorStop(.52, '#0b955f');
  brandGradient.addColorStop(1, '#07764d');
  ctx.fillStyle = brandGradient;
  roundedRect(ctx, 82, 76, 916, 274, 44);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.16)';
  roundedRect(ctx, 128, 124, 112, 112, 30);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 58px Arial, sans-serif';
  ctx.fillText('E', 166, 198);
  ctx.font = '900 50px Arial, sans-serif';
  ctx.fillText('Emprestei', 278, 178);
  ctx.fillStyle = 'rgba(255,255,255,.76)';
  ctx.font = '800 19px Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('CONTROLE DE EMPRÉSTIMOS', 280, 218);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#8194a5';
  ctx.font = '900 17px Arial, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText('DOCUMENTO', 112, 410);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#0b1a28';
  ctx.font = '900 43px Arial, sans-serif';
  wrapCanvasText(ctx, data.title, 112, 468, 620, 50, 2);

  ctx.fillStyle = '#eef3f7';
  roundedRect(ctx, 758, 392, 208, 58, 29);
  ctx.fill();
  ctx.fillStyle = '#667e91';
  ctx.font = '900 18px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(data.number, 862, 429);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#f5f8fb';
  roundedRect(ctx, 112, 552, 854, 126, 30);
  ctx.fill();
  ctx.fillStyle = '#8295a6';
  ctx.font = '900 17px Arial, sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText('CLIENTE', 144, 596);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#0c1c2a';
  ctx.font = '900 32px Arial, sans-serif';
  wrapCanvasText(ctx, data.client, 144, 642, 760, 38, 1);

  const gap = 20;
  const fullWidth = 854;
  const halfWidth = (fullWidth - gap) / 2;
  let cursorY = 710;
  let pendingHalf = false;

  data.fields.forEach((field) => {
    if (field.wide) {
      if (pendingHalf) {
        cursorY += 146;
        pendingHalf = false;
      }
      drawField(ctx, field, 112, cursorY, fullWidth, 126);
      cursorY += 146;
      return;
    }

    const x = pendingHalf ? 112 + halfWidth + gap : 112;
    drawField(ctx, field, x, cursorY, halfWidth, 126);
    if (pendingHalf) cursorY += 146;
    pendingHalf = !pendingHalf;
  });
  if (pendingHalf) cursorY += 146;

  const highlightY = Math.min(Math.max(cursorY + 10, 1135), 1250);
  ctx.fillStyle = '#e6faef';
  roundedRect(ctx, 112, highlightY, 854, 132, 30);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,167,104,.15)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#438f6c';
  ctx.font = '900 17px Arial, sans-serif';
  ctx.letterSpacing = '1.5px';
  ctx.fillText(data.highlightLabel.toUpperCase(), 148, highlightY + 47);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#08794e';
  ctx.font = '900 43px Arial, sans-serif';
  ctx.fillText(data.highlightValue, 148, highlightY + 100);

  const disclaimerY = Math.min(highlightY + 205, 1438);
  ctx.strokeStyle = '#dce6eb';
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(132, disclaimerY - 36);
  ctx.lineTo(946, disclaimerY - 36);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8495a2';
  ctx.font = '500 17px Arial, sans-serif';
  ctx.textAlign = 'center';
  wrapCanvasText(ctx, data.disclaimer, 540, disclaimerY, 770, 25, 3);
  ctx.textAlign = 'left';

  return canvas;
}

async function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = .96) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao gerar o arquivo.')), type, quality);
  });
}

function dataUrlBytes(dataUrl: string) {
  const raw = atob(dataUrl.split(',')[1] || '');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}

function pdfFromCanvas(canvas: HTMLCanvasElement) {
  const encoder = new TextEncoder();
  const jpeg = dataUrlBytes(canvas.toDataURL('image/jpeg', .94));
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 22;
  const scale = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height);
  const drawWidth = canvas.width * scale;
  const drawHeight = canvas.height * scale;
  const drawX = (pageWidth - drawWidth) / 2;
  const drawY = (pageHeight - drawHeight) / 2;
  const content = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ\n`;

  const parts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let size = 0;
  const push = (bytes: Uint8Array) => { parts.push(bytes); size += bytes.length; };
  const text = (value: string) => push(encoder.encode(value));
  const object = (number: number, body: string) => { offsets[number] = size; text(`${number} 0 obj\n${body}\nendobj\n`); };

  text('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);

  offsets[4] = size;
  text(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  text('\nendstream\nendobj\n');

  const contentBytes = encoder.encode(content);
  offsets[5] = size;
  text(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  text('endstream\nendobj\n');

  const xrefOffset = size;
  text('xref\n0 6\n0000000000 65535 f \n');
  for (let index = 1; index <= 5; index += 1) text(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob([concatBytes(parts)], { type: 'application/pdf' });
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function receiptToast(text: string) {
  document.querySelector('.receipt-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'receipt-toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

async function shareFile(file: File, title: string, message: string) {
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title, text: message, files: [file] });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return true;
    }
  }
  downloadFile(file, file.name);
  return false;
}

async function shareImage(modal: HTMLElement, button: HTMLButtonElement) {
  const original = button.textContent || 'Compartilhar imagem';
  button.disabled = true;
  button.textContent = 'Gerando imagem...';
  try {
    const data = readReceiptModal(modal);
    const canvas = buildReceiptCanvas(data);
    const blob = await canvasBlob(canvas, 'image/png');
    const file = new File([blob], `${data.number}.png`, { type: 'image/png' });
    const shared = await shareFile(file, data.title, `Comprovante Emprestei · ${data.client}`);
    if (!shared) receiptToast('Imagem salva. Abra o WhatsApp e envie o arquivo ao cliente.');
  } catch {
    receiptToast('Não foi possível gerar a imagem agora.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function sharePdf(modal: HTMLElement, button: HTMLButtonElement) {
  const original = button.textContent || 'Compartilhar PDF';
  button.disabled = true;
  button.textContent = 'Gerando PDF...';
  try {
    const data = readReceiptModal(modal);
    const canvas = buildReceiptCanvas(data);
    const blob = pdfFromCanvas(canvas);
    const file = new File([blob], `${data.number}.pdf`, { type: 'application/pdf' });
    const shared = await shareFile(file, data.title, `Comprovante Emprestei · ${data.client}`);
    if (!shared) receiptToast('PDF salvo no aparelho.');
  } catch {
    receiptToast('Não foi possível gerar o PDF agora.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function decorateReceiptModal(modal: HTMLElement) {
  if (modal.dataset.shareUpgrade === '1') return;
  const actions = modal.querySelector<HTMLElement>('.receipt-modal-actions');
  const currentPrimary = actions?.querySelector<HTMLButtonElement>('.receipt-primary');
  if (!actions || !currentPrimary) return;

  modal.dataset.shareUpgrade = '1';
  const originalSecondary = actions.querySelector<HTMLButtonElement>('.receipt-secondary');
  if (originalSecondary) {
    originalSecondary.textContent = 'Mensagem';
    originalSecondary.classList.add('receipt-message-action');
    originalSecondary.title = 'Enviar uma mensagem de texto ao WhatsApp cadastrado';
  }

  const imageButton = currentPrimary.cloneNode(true) as HTMLButtonElement;
  imageButton.className = 'receipt-primary receipt-share-image';
  imageButton.textContent = 'Compartilhar imagem';
  currentPrimary.replaceWith(imageButton);
  imageButton.addEventListener('click', () => void shareImage(modal, imageButton));

  const pdfButton = document.createElement('button');
  pdfButton.type = 'button';
  pdfButton.className = 'receipt-pdf-action';
  pdfButton.textContent = 'Compartilhar PDF';
  pdfButton.addEventListener('click', () => void sharePdf(modal, pdfButton));
  actions.appendChild(pdfButton);

  const hint = document.createElement('div');
  hint.className = 'receipt-share-hint';
  hint.innerHTML = '<span class="receipt-share-hint-icon">↗</span><span><strong>Pronto para enviar</strong><small>Use Imagem ou PDF e escolha o WhatsApp no compartilhamento do celular.</small></span>';
  actions.insertAdjacentElement('beforebegin', hint);
}

function findAndDecorate() {
  document.querySelectorAll<HTMLElement>('.receipt-modal').forEach(decorateReceiptModal);
}

const receiptShareObserver = new MutationObserver(findAndDecorate);
if (document.body) receiptShareObserver.observe(document.body, { childList: true, subtree: true });
findAndDecorate();

export {};
