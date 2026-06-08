/**
 * MHS Marketing Dashboard — User Manual Generator
 * Reads manual_sections_raw.txt, converts Markdown to Word (docx-js)
 */

const fs = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, TableOfContents,
  LevelFormat, ExternalHyperlink,
} = require('docx');

// ── Helper: fix mojibake from Windows-1252 read as UTF-8 ──────────────────
function fixEncoding(str) {
  return str
    .replace(/â€"/g, '—')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€/g, '”')
    .replace(/â€˜/g, '‘')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ã /g, 'à')
    .replace(/â—/g, '—')
    .replace(/â€“/g, '—')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”');
}

// ── Colour palette ──────────────────────────────────────────────────────────
const DARK_BLUE   = '1F3864';
const MID_BLUE    = '2E75B6';
const LIGHT_BLUE  = 'D6E4F0';
const ACCENT_BLUE = '4472C4';
const GREY_BG     = 'F2F2F2';
const WHITE       = 'FFFFFF';
const TEXT_BLACK  = '1A1A1A';

// ── Parse a Markdown bold-inline string into TextRun array ─────────────────
function parseBoldInline(rawText) {
  const text = fixEncoding(rawText);
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map(p => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return new TextRun({ text: p.slice(2, -2), bold: true, color: TEXT_BLACK });
    }
    return new TextRun({ text: p, color: TEXT_BLACK });
  });
}

// ── Create a horizontal rule paragraph ────────────────────────────────────
function hrParagraph() {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: MID_BLUE, space: 1 } },
    spacing: { before: 120, after: 120 },
  });
}

// ── Create a shaded "Important Note" or "Warning" block ────────────────────
function shadedNote(text, isWarning = false) {
  const bgColor = isWarning ? 'FFF3CD' : LIGHT_BLUE;
  const borderColor = isWarning ? 'FF8C00' : MID_BLUE;
  return new Paragraph({
    children: parseBoldInline(text),
    shading: { fill: bgColor, type: ShadingType.CLEAR },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: borderColor, space: 8 },
    },
    spacing: { before: 80, after: 80 },
    indent: { left: 300, right: 300 },
    style: 'Normal',
  });
}

// ── Parse a Markdown section into Paragraph array ──────────────────────────
function parseMarkdown(markdown, listRef) {
  const lines = markdown.split('\n');
  const paragraphs = [];
  let inTable = false;
  let tableRows = [];
  let tableHeaders = [];
  let inCodeBlock = false;

  function flushTable() {
    if (tableHeaders.length === 0 && tableRows.length === 0) return;
    const colCount = tableHeaders.length || (tableRows[0] ? tableRows[0].length : 1);
    const contentWidth = 9360;
    const colWidth = Math.floor(contentWidth / colCount);
    const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
    const borders = { top: border, bottom: border, left: border, right: border };

    const allRows = [];

    // Header row
    if (tableHeaders.length > 0) {
      allRows.push(new TableRow({
        tableHeader: true,
        children: tableHeaders.map((h, i) =>
          new TableCell({
            borders,
            width: { size: colWidth, type: WidthType.DXA },
            shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              children: [new TextRun({ text: fixEncoding(h.trim()), bold: true, color: WHITE, size: 20 })],
              alignment: AlignmentType.CENTER,
            })],
          })
        ),
      }));
    }

    // Data rows
    tableRows.forEach((row, rowIdx) => {
      allRows.push(new TableRow({
        children: row.map((cell, i) =>
          new TableCell({
            borders,
            width: { size: colWidth, type: WidthType.DXA },
            shading: { fill: rowIdx % 2 === 0 ? WHITE : 'EBF3FA', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: parseBoldInline(cell.trim()) })],
          })
        ),
      }));
    });

    if (allRows.length > 0) {
      paragraphs.push(new Table({
        width: { size: contentWidth, type: WidthType.DXA },
        columnWidths: Array(colCount).fill(colWidth),
        rows: allRows,
      }));
    }

    inTable = false;
    tableRows = [];
    tableHeaders = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Code block toggle
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: fixEncoding(line), font: 'Courier New', size: 18, color: '444444' })],
        shading: { fill: 'F5F5F5', type: ShadingType.CLEAR },
        indent: { left: 360 },
        spacing: { before: 0, after: 0 },
      }));
      continue;
    }

    // Table rows
    if (line.startsWith('|')) {
      const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      // Skip separator rows like |---|---|
      if (cells.every(c => /^[-: ]+$/.test(c))) { inTable = true; continue; }
      if (!inTable && tableHeaders.length === 0) {
        tableHeaders = cells;
        inTable = true;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Skip raw dividers
    if (/^---+$/.test(line.trim())) {
      paragraphs.push(hrParagraph());
      continue;
    }

    // Skip empty
    if (line.trim() === '') {
      paragraphs.push(new Paragraph({ children: [new TextRun('')], spacing: { before: 0, after: 60 } }));
      continue;
    }

    // Headings
    const h4 = line.match(/^####\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);

    if (h1) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: fixEncoding(h1[1]), color: WHITE, bold: true, size: 36 })], shading: { fill: DARK_BLUE, type: ShadingType.CLEAR }, spacing: { before: 360, after: 240 } }));
      continue;
    }
    if (h2) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: fixEncoding(h2[1]), color: DARK_BLUE, bold: true, size: 28 })], spacing: { before: 300, after: 180 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_BLUE, space: 2 } } }));
      continue;
    }
    if (h3) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: fixEncoding(h3[1]), color: MID_BLUE, bold: true, size: 24 })], spacing: { before: 240, after: 120 } }));
      continue;
    }
    if (h4) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: fixEncoding(h4[1]), bold: true, color: TEXT_BLACK, size: 22 })], spacing: { before: 180, after: 100 } }));
      continue;
    }

    // Bullet lists: - item or * item
    const bullet = line.match(/^(\s*)[-*]\s+(.*)/);
    if (bullet) {
      const indent = bullet[1].length > 0 ? 1 : 0;
      paragraphs.push(new Paragraph({
        numbering: { reference: 'bullets', level: indent },
        children: parseBoldInline(bullet[2]),
        spacing: { before: 40, after: 40 },
      }));
      continue;
    }

    // Numbered lists: 1. item
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)/);
    if (numbered) {
      paragraphs.push(new Paragraph({
        numbering: { reference: 'numbers', level: 0 },
        children: parseBoldInline(numbered[2]),
        spacing: { before: 40, after: 40 },
      }));
      continue;
    }

    // Important notes / warnings
    const noteMatch = line.match(/^\*?\*?(Important Note|Note|Warning|IMPORTANT|⚠️)[:\s](.*)$/i);
    if (noteMatch) {
      paragraphs.push(shadedNote(line, /warning|⚠/i.test(line)));
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      paragraphs.push(new Paragraph({
        children: parseBoldInline(line.slice(2)),
        shading: { fill: 'F0F4FF', type: ShadingType.CLEAR },
        indent: { left: 600 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT_BLUE, space: 8 } },
        spacing: { before: 80, after: 80 },
      }));
      continue;
    }

    // Normal paragraph
    paragraphs.push(new Paragraph({
      children: parseBoldInline(line),
      spacing: { before: 60, after: 60 },
    }));
  }

  if (inTable) flushTable();
  return paragraphs;
}

// ── Read and parse the sections file ──────────────────────────────────────
const rawFilePath = path.join(__dirname, 'manual_sections_raw.txt');
const rawContent = fs.readFileSync(rawFilePath, 'utf8');

const sectionBlocks = rawContent.split('<<<SECTION_START>>>').filter(b => b.trim());
const sections = [];

for (const block of sectionBlocks) {
  const titleMatch = block.match(/TITLE:\s*(.+)/);
  const contentMatch = block.match(/<<<CONTENT_START>>>([\s\S]*?)<<<SECTION_END>>>/);
  if (titleMatch && contentMatch) {
    sections.push({
      title: fixEncoding(titleMatch[1].trim()),
      content: contentMatch[1].trim(),
    });
  }
}

console.log(`Parsed ${sections.length} sections`);
sections.forEach(s => console.log('  -', s.title.substring(0, 60)));

// ── Build all document children ───────────────────────────────────────────
const listRef = {};
const allChildren = [];

// ── Cover Page ────────────────────────────────────────────────────────────
allChildren.push(
  new Paragraph({
    children: [new TextRun({ text: '', size: 48 })],
    spacing: { before: 1440, after: 0 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'MY HEALTH SCHOOL', bold: true, size: 36, color: MID_BLUE, allCaps: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'MHS Marketing Dashboard', bold: true, size: 64, color: DARK_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Complete User Manual', size: 48, color: MID_BLUE, italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 480 },
  }),
  // Blue divider bar
  new Paragraph({
    children: [new TextRun({ text: ' '.repeat(80) })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    spacing: { before: 0, after: 0 },
  }),
  new Paragraph({
    children: [new TextRun({ text: '' })],
    spacing: { before: 480, after: 0 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Version 1.0', size: 28, color: '555555' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'June 2026', size: 28, color: '555555' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Confidential — My Health School (MHS)', size: 24, color: '888888', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'info@myhealthschool.in', size: 24, color: MID_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 0 },
  }),
  // Page break after cover
  new Paragraph({ children: [new PageBreak()] }),
);

// ── Table of Contents ────────────────────────────────────────────────────
allChildren.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: 'Table of Contents', color: WHITE, bold: true, size: 36 })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    spacing: { before: 0, after: 240 },
  }),
  new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-3',
  }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ── Section content ─────────────────────────────────────────────────────
for (let si = 0; si < sections.length; si++) {
  const sec = sections[si];
  const parsed = parseMarkdown(sec.content, listRef);
  allChildren.push(...parsed);

  // Page break between sections (not after last)
  if (si < sections.length - 1) {
    allChildren.push(new Paragraph({ children: [new PageBreak()] }));
  }
}

// ── Build Document ───────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { color: MID_BLUE } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } }, run: { color: '666666' } } },
        ],
      },
      {
        reference: 'numbers',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22, color: TEXT_BLACK },
      },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: WHITE },
        paragraph: {
          spacing: { before: 360, after: 240 },
          outlineLevel: 0,
          shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
        },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: DARK_BLUE },
        paragraph: {
          spacing: { before: 300, after: 180 },
          outlineLevel: 1,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_BLUE, space: 2 } },
        },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: MID_BLUE },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'MHS Marketing Dashboard — User Manual', bold: true, color: MID_BLUE, size: 18 }),
                new TextRun({ text: '\t\tConfidential · My Health School', color: '888888', size: 16 }),
              ],
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE, space: 2 } },
              tabStops: [{ type: 'right', position: 9360 }],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: '© 2026 My Health School | info@myhealthschool.in\t', color: '888888', size: 16 }),
                new TextRun({ text: 'Page ', color: '888888', size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], color: MID_BLUE, size: 16 }),
                new TextRun({ text: ' of ', color: '888888', size: 16 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], color: MID_BLUE, size: 16 }),
              ],
              alignment: AlignmentType.CENTER,
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE, space: 2 } },
              tabStops: [{ type: 'right', position: 9360 }],
            }),
          ],
        }),
      },
      children: allChildren,
    },
  ],
});

// ── Write output ─────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'MHS_Marketing_Dashboard_User_Manual.docx');

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\n✅ SUCCESS: ${outPath}`);
  console.log(`   File size: ${size} KB`);
}).catch(err => {
  console.error('❌ ERROR:', err.message);
  process.exit(1);
});
