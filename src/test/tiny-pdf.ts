/**
 * §12.122. A real, minimal PDF built in memory from invented text, for tests
 * that must go through pdf.js: one Helvetica text run per entry, placed
 * where it is told. No file is read and none is written.
 */

export interface TinyRun {
  x: number;
  y: number;
  text: string;
}

const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function tinyPdf(pages: TinyRun[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objects.length + 1 + pages.length * 2;
  const kids: number[] = [];
  for (const runs of pages) {
    const stream = runs
      .map((r) => `BT /F1 9 Tf ${r.x} ${r.y} Td (${escape(r.text)}) Tj ET`)
      .join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** One scanned page: a JPEG, its size in pixels, and the page it covers in PDF units (Letter unless said). */
export interface ScannedPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  media?: [number, number];
}

/**
 * §12.128. A scan, as a scanner writes one: every page a single JPEG drawn
 * over the whole page, and no text at all. Built in bytes, not characters,
 * because the images are binary. No file is read and none is written.
 */
export function tinyScanPdf(pages: ScannedPage[]): Uint8Array {
  const encoder = new TextEncoder();
  const objects: (string | { head: string; data: Uint8Array })[] = [];
  const add = (body: string | { head: string; data: Uint8Array }) => {
    objects.push(body);
    return objects.length;
  };
  const pagesId = 1 + pages.length * 3;
  const kids: number[] = [];
  for (const page of pages) {
    const [w, h] = page.media ?? [612, 792];
    const image = add({
      head: `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      data: page.jpeg,
    });
    const stream = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im1 ${image} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const parts: Uint8Array[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  write('%PDF-1.4\n');
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    if (typeof body === 'string') write(`${i + 1} 0 obj\n${body}\nendobj\n`);
    else {
      write(`${i + 1} 0 obj\n${body.head}\nstream\n`);
      write(body.data);
      write('\nendstream\nendobj\n');
    }
  });
  const xref = length;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) write(`${String(offset).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
