/**
 * MHS Marketing Dashboard — MCQ Evaluation (Easy + Medium Only)
 * Part A: Question Paper (no answers) | Part B: Answer Key
 */

const fs   = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, LevelFormat, TabStopType, TabStopPosition,
} = require('docx');

// ── Palette ──────────────────────────────────────────────────────────────────
const DARK_BLUE  = '1F3864';
const MID_BLUE   = '2E75B6';
const LIGHT_BLUE = 'D6E4F0';
const PALE_BLUE  = 'EBF3FB';
const GREEN      = '1E7B34';
const PALE_GREEN = 'E2F0D9';
const ORANGE     = 'C55A11';
const PALE_ORG   = 'FCE4D6';
const WHITE      = 'FFFFFF';
const BLACK      = '1A1A1A';
const GREY       = 'F2F2F2';
const YELLOW     = 'FFF2CC';

const W = 9360; // US Letter content width (DXA, 1" margins)

// ── MCQ Data ──────────────────────────────────────────────────────────────────
// Each: { level, no, question, options:[A,B,C,D], answer:'A'|'B'|'C'|'D', topic }
const QUESTIONS = [
  // ── EASY ──
  {
    level: 'EASY', no: 1,
    topic: 'Ads Metrics — CPC',
    question: 'Which metric in the Ads Analytics Dashboard shows you the average amount spent each time someone clicks on your ad?',
    options: ['CPM  (Cost Per Mille)', 'ROAS  (Return on Ad Spend)', 'CPC  (Cost Per Click)', 'CTR  (Click Through Rate)'],
    answer: 'C',
  },
  {
    level: 'EASY', no: 2,
    topic: 'Lead Sync',
    question: 'How often does the dashboard automatically sync new leads from Meta (Facebook) lead forms?',
    options: ['Every 30 minutes', 'Once a day', 'Every 5 minutes', 'Every 1 hour'],
    answer: 'C',
  },
  {
    level: 'EASY', no: 3,
    topic: 'Immediate Sync',
    question: 'If you want leads to sync right now without waiting, which button should you click on the Ads Dashboard page?',
    options: ['Refresh Page', 'Export CSV', 'Sync All Leads', 'Update Token'],
    answer: 'C',
  },
  {
    level: 'EASY', no: 4,
    topic: 'ROAS Meaning',
    question: 'In the Ads Dashboard, a ROAS value of 5 means that for every Rs. 1 your team spends on ads, the campaign returns ___.',
    options: ['Rs. 0.50 in revenue', 'Rs. 5 in revenue', 'Rs. 50 in revenue', 'Rs. 1 in revenue'],
    answer: 'B',
  },
  {
    level: 'EASY', no: 5,
    topic: 'Theme Toggle',
    question: 'Where can you find the option to switch between Light Mode and Dark Mode in the dashboard?',
    options: ['Meta Settings page', 'Profile Dropdown menu', 'Top Bar toggle icon', 'Reports page'],
    answer: 'C',
  },
  {
    level: 'EASY', no: 6,
    topic: 'Best Performing Reel',
    question: 'Which page in the dashboard shows you which Instagram Reels are getting the most views, shares, and saves?',
    options: ['Audience Analytics', 'AI Insights', 'Best Performing Reel', 'Reports'],
    answer: 'C',
  },
  {
    level: 'EASY', no: 7,
    topic: 'Audience Analytics',
    question: 'Where in the dashboard can you see the age group and gender breakdown of your Instagram audience followers?',
    options: ['Best Performing Ad', 'Plan & Targets', 'Home Dashboard', 'Audience Analytics'],
    answer: 'D',
  },
  {
    level: 'EASY', no: 8,
    topic: 'Date Filter Presets',
    question: 'Which of the following is a date range preset available in the dashboard date filters?',
    options: ['Last 3 Years', 'Last 90 Days', 'Last 7 Days', 'Last 6 Months'],
    answer: 'C',
  },
  // ── MEDIUM ──
  {
    level: 'MEDIUM', no: 9,
    topic: 'Plan & Targets',
    question: 'Your team wants to set a monthly ad spend budget and track how much has actually been spent so far this month. Which module should they use?',
    options: ['AI Insights', 'Reports', 'Collaboration', 'Plan & Targets'],
    answer: 'D',
  },
  {
    level: 'MEDIUM', no: 10,
    topic: 'Exporting Leads',
    question: 'To export all leads collected in the last 30 days as a CSV file, which page should you navigate to first?',
    options: ['Reports', 'Home Dashboard', 'Unique Leads', 'AI Insights'],
    answer: 'C',
  },
  {
    level: 'MEDIUM', no: 11,
    topic: 'Hook Rate',
    question: '"Hook Rate" in the Ads Dashboard measures the percentage of viewers who watched at least the first ___ seconds of your video ad.',
    options: ['5 seconds', '10 seconds', '15 seconds', '3 seconds'],
    answer: 'D',
  },
  {
    level: 'MEDIUM', no: 12,
    topic: 'AI Insights',
    question: 'Which module in the dashboard uses Google Gemini AI to give marketing recommendations and lead quality scores?',
    options: ['Reports', 'Team Goals', 'AI Insights', 'Meta Settings'],
    answer: 'C',
  },
  {
    level: 'MEDIUM', no: 13,
    topic: 'Downloading Reports',
    question: 'A manager wants to download a campaign performance report for a specific date range as an Excel or CSV file. Which page should they visit?',
    options: ['Home Dashboard', 'Audience Analytics', 'AI Insights', 'Reports'],
    answer: 'D',
  },
  {
    level: 'MEDIUM', no: 14,
    topic: 'Meta Token',
    question: 'The leads table shows a permission error. The most likely reason is that the Meta Access Token has ________.',
    options: ['Been deleted by a user', 'Expired (approx. every 90 days)', 'Been blocked by Facebook', 'Changed its password'],
    answer: 'B',
  },
  {
    level: 'MEDIUM', no: 15,
    topic: 'Best Performing Ad',
    question: 'A marketer wants to find out which ad creative brought in the most leads last month. Which page should they visit?',
    options: ['Home Dashboard', 'Audience Analytics', 'Best Performing Ad', 'Plan & Targets'],
    answer: 'C',
  },
];

const EASY_Qs   = QUESTIONS.filter(q => q.level === 'EASY');
const MEDIUM_Qs = QUESTIONS.filter(q => q.level === 'MEDIUM');

// ── Helpers ───────────────────────────────────────────────────────────────────
const r  = (text, opts={}) => new TextRun({ text: String(text), font: 'Calibri', ...opts });
const b  = (text, opts={}) => r(text, { bold: true, ...opts });

const blk = () => new Paragraph({ children: [r('')], spacing: { before: 60, after: 60 } });

const thinB  = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const allB   = { top: thinB, bottom: thinB, left: thinB, right: thinB };
const noB    = { style: BorderStyle.NONE, size: 0, color: WHITE };
const noAll  = { top: noB, bottom: noB, left: noB, right: noB };

function cell(ch, w, fill=WHITE, isBold=false, color=BLACK, align=AlignmentType.LEFT) {
  return new TableCell({
    borders: allB,
    width: { size: w, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: Array.isArray(ch) ? ch : [r(String(ch), { bold: isBold, color, size: 20 })],
      alignment: align,
    })],
  });
}
function hdrCell(text, w) {
  return cell(text, w, DARK_BLUE, true, WHITE, AlignmentType.CENTER);
}

function makeHeader(subtitle) {
  return new Header({ children: [new Paragraph({
    children: [
      b('MHS Marketing Dashboard  ', { color: MID_BLUE, size: 18 }),
      r('|  ', { color: 'AAAAAA', size: 18 }),
      r(subtitle, { color: '555555', size: 18 }),
      r('\t', { size: 18 }),
      r('My Health School — Confidential', { color: 'AAAAAA', size: 16, italics: true }),
    ],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE, space: 2 } },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
  })]});
}

function makeFooter() {
  return new Footer({ children: [new Paragraph({
    children: [
      r('© 2026 My Health School  |  info@myhealthschool.in', { color: 'AAAAAA', size: 16 }),
      r('\t', { size: 16 }),
      r('Page ', { color: '888888', size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', color: MID_BLUE, size: 16 }),
      r(' of ', { color: '888888', size: 16 }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', color: MID_BLUE, size: 16 }),
    ],
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE, space: 2 } },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
  })]});
}

// ── Question block for Part A ─────────────────────────────────────────────────
// Option labels
const OPT_LABELS = ['A', 'B', 'C', 'D'];
const TICK = '( )';

function questionBlock(q, serialNo) {
  const isEasy  = q.level === 'EASY';
  const tagFill = isEasy ? PALE_GREEN  : PALE_ORG;
  const tagBord = isEasy ? GREEN       : ORANGE;
  const tagText = isEasy ? 'EASY'      : 'MEDIUM';
  const tagCol  = isEasy ? GREEN       : ORANGE;
  const result  = [];

  // ── Question row ─────────────────────────────────────────────────────────
  result.push(new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [660, 7500, 1200],
    rows: [new TableRow({ children: [
      // Q number
      new TableCell({
        borders: allB,
        width: { size: 660, type: WidthType.DXA },
        shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 120, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [b(`Q${serialNo}`, { color: WHITE, size: 26 })],
          alignment: AlignmentType.CENTER,
        })],
      }),
      // Question text
      new TableCell({
        borders: allB,
        width: { size: 7500, type: WidthType.DXA },
        shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 180, right: 120 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [r(q.question, { size: 22, color: BLACK })],
          spacing: { before: 0, after: 0 },
        })],
      }),
      // Difficulty badge
      new TableCell({
        borders: allB,
        width: { size: 1200, type: WidthType.DXA },
        shading: { fill: tagFill, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 80, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({ children: [b(tagText, { color: tagCol, size: 18 })], alignment: AlignmentType.CENTER }),
          new Paragraph({ children: [r(q.topic, { color: '666666', size: 16, italics: true })], alignment: AlignmentType.CENTER }),
        ],
      }),
    ]})],
  }));

  // ── Options (2×2 grid) ────────────────────────────────────────────────────
  result.push(new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    rows: [
      new TableRow({ children: [0, 1].map(i => new TableCell({
        borders: { top: noB, bottom: noB, left: i===0?{ style: BorderStyle.SINGLE, size: 6, color: tagBord }:noB, right: noB },
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill: i%2===0?GREY:WHITE, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 200, right: 120 },
        children: [new Paragraph({
          children: [
            b(`${OPT_LABELS[i]}.  `, { color: DARK_BLUE, size: 22 }),
            r(q.options[i], { size: 22, color: BLACK }),
            r('   ' + TICK, { size: 20, color: 'AAAAAA' }),
          ],
          spacing: { before: 60, after: 60 },
        })],
      })) }),
      new TableRow({ children: [2, 3].map(i => new TableCell({
        borders: { top: noB, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' }, left: i===2?{ style: BorderStyle.SINGLE, size: 6, color: tagBord }:noB, right: noB },
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill: (i)%2===0?GREY:WHITE, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 200, right: 120 },
        children: [new Paragraph({
          children: [
            b(`${OPT_LABELS[i]}.  `, { color: DARK_BLUE, size: 22 }),
            r(q.options[i], { size: 22, color: BLACK }),
            r('   ' + TICK, { size: 20, color: 'AAAAAA' }),
          ],
          spacing: { before: 60, after: 60 },
        })],
      })) }),
    ],
  }));

  // small gap after each question
  result.push(blk());
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// COVER PAGE
// ════════════════════════════════════════════════════════════════════════════
const coverChildren = [
  new Paragraph({ children: [r('')], spacing: { before: 1440, after: 0 } }),

  new Paragraph({
    children: [r(' ', { size: 4 })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    spacing: { before: 0, after: 0 },
  }),

  new Paragraph({ children: [r('')], spacing: { before: 400, after: 0 } }),

  new Paragraph({
    children: [b('MY HEALTH SCHOOL', { size: 28, color: MID_BLUE, allCaps: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [b('MHS Marketing Dashboard', { size: 60, color: DARK_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 60 },
  }),
  new Paragraph({
    children: [b('Knowledge Transfer Evaluation', { size: 44, color: MID_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }),
  new Paragraph({
    children: [r('Multiple Choice Questions  —  Choose the Best Answer', { size: 26, color: '666666', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 480 },
  }),

  new Paragraph({
    children: [r(' ', { size: 4 })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    spacing: { before: 0, after: 0 },
  }),

  new Paragraph({ children: [r('')], spacing: { before: 360, after: 0 } }),

  // Summary table
  new Table({
    width: { size: 7200, type: WidthType.DXA },
    columnWidths: [2800, 4400],
    rows: [
      new TableRow({ children: [cell('Document Type', 2800, PALE_BLUE, true, DARK_BLUE), cell('Post-KT MCQ Assessment', 4400)] }),
      new TableRow({ children: [cell('Application', 2800, PALE_BLUE, true, DARK_BLUE), cell('MHS Marketing Dashboard', 4400)] }),
      new TableRow({ children: [cell('Question Format', 2800, PALE_BLUE, true, DARK_BLUE), cell('Multiple Choice — 4 Options Each', 4400)] }),
      new TableRow({ children: [cell('Total Questions', 2800, PALE_BLUE, true, DARK_BLUE), cell('15  (Easy: 8  |  Medium: 7)', 4400)] }),
      new TableRow({ children: [cell('Total Marks', 2800, PALE_BLUE, true, DARK_BLUE), cell('15 Marks  (1 Mark per Question)', 4400)] }),
      new TableRow({ children: [cell('Estimated Duration', 2800, PALE_BLUE, true, DARK_BLUE), cell('15 – 20 Minutes', 4400)] }),
      new TableRow({ children: [cell('Levels Covered', 2800, PALE_BLUE, true, DARK_BLUE), cell('Easy  |  Medium  (No Advanced)', 4400)] }),
      new TableRow({ children: [cell('Version', 2800, PALE_BLUE, true, DARK_BLUE), cell('1.0  —  June 2026', 4400)] }),
    ],
  }),

  new Paragraph({ children: [r('')], spacing: { before: 360, after: 0 } }),
  new Paragraph({
    children: [r('This document contains TWO parts:', { size: 22, color: DARK_BLUE, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
  }),
  new Paragraph({
    children: [r('Part A — Question Paper  (share with candidate)     |     Part B — Answer Key  (keep with evaluator)', { size: 20, color: '555555', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }),
  new Paragraph({
    children: [r('info@myhealthschool.in', { size: 20, color: MID_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 0 },
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ════════════════════════════════════════════════════════════════════════════
// PART A — QUESTION PAPER
// ════════════════════════════════════════════════════════════════════════════
const partAChildren = [

  // Part A title bar
  new Paragraph({
    children: [b('PART A  —  QUESTION PAPER', { size: 40, color: WHITE })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }),
  new Paragraph({
    children: [r('Choose the Best Answer  |  Circle or tick the correct option  |  1 Mark per question', { size: 20, color: WHITE, italics: true })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }),

  blk(),

  // Candidate row
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [3600, 3360, 2400],
    rows: [new TableRow({ children: [
      cell([b('Name: ', { color: DARK_BLUE, size: 21 }), r('_________________________________', { size: 21 })], 3600, PALE_BLUE),
      cell([b('Date: ', { color: DARK_BLUE, size: 21 }), r('___________________________', { size: 21 })], 3360, PALE_BLUE),
      cell([b('Score: ', { color: DARK_BLUE, size: 21 }), r('_______ / 15', { size: 21 })], 2400, PALE_BLUE),
    ]})],
  }),

  blk(),

  // Instructions
  new Paragraph({
    children: [b('Instructions', { size: 22, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: { before: 120, after: 60 },
  }),
  ...['1.  This paper has 15 multiple-choice questions.',
      '2.  Each question has FOUR options (A, B, C, D). Choose the ONE best answer.',
      '3.  Mark your answer by circling or ticking the option (  ) next to your choice.',
      '4.  Each correct answer is worth 1 mark. Total: 15 marks.',
      '5.  There is no negative marking. Attempt all questions.',
      '6.  Time allowed: 15–20 minutes.'].map(line =>
    new Paragraph({
      children: [r(line, { size: 21, color: BLACK })],
      shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: MID_BLUE, space: 6 } },
      indent: { left: 240, right: 160 },
      spacing: { before: 40, after: 40 },
    })
  ),

  blk(),

  // ── EASY SECTION ─────────────────────────────────────────────────────────
  new Paragraph({
    children: [b('SECTION 1 : EASY QUESTIONS  (Q1 – Q8)', { size: 28, color: WHITE })],
    shading: { fill: GREEN, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 0 },
  }),
  new Paragraph({
    children: [r('8 Questions  |  1 Mark each  |  Total: 8 Marks', { size: 20, color: '444444', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 120 },
  }),

  ...EASY_Qs.flatMap((q, i) => questionBlock(q, i + 1)),

  // ── MEDIUM SECTION ────────────────────────────────────────────────────────
  new Paragraph({
    children: [b('SECTION 2 : MEDIUM QUESTIONS  (Q9 – Q15)', { size: 28, color: WHITE })],
    shading: { fill: ORANGE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 0 },
  }),
  new Paragraph({
    children: [r('7 Questions  |  1 Mark each  |  Total: 7 Marks', { size: 20, color: '444444', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 120 },
  }),

  ...MEDIUM_Qs.flatMap((q, i) => questionBlock(q, EASY_Qs.length + i + 1)),

  blk(),

  // Score box at the end
  new Paragraph({
    children: [b('TOTAL SCORE  : _______ / 15', { size: 26, color: WHITE })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ════════════════════════════════════════════════════════════════════════════
// PART B — ANSWER KEY
// ════════════════════════════════════════════════════════════════════════════

// Answer key table rows
const answerRows = QUESTIONS.map((q, idx) => {
  const isEasy  = q.level === 'EASY';
  const lvlFill = isEasy ? PALE_GREEN : PALE_ORG;
  const lvlCol  = isEasy ? GREEN      : ORANGE;
  const serial  = idx + 1;
  const correctLetter = q.answer;                          // 'A' 'B' 'C' 'D'
  const correctText   = q.options[OPT_LABELS.indexOf(correctLetter)];  // option text

  return new TableRow({
    children: [
      // Q no
      new TableCell({
        borders: allB,
        width: { size: 560, type: WidthType.DXA },
        shading: { fill: idx%2===0 ? WHITE : GREY, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 100, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [b(`Q${serial}`, { color: DARK_BLUE, size: 20 })], alignment: AlignmentType.CENTER })],
      }),
      // Topic
      new TableCell({
        borders: allB,
        width: { size: 2000, type: WidthType.DXA },
        shading: { fill: idx%2===0 ? WHITE : GREY, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [r(q.topic, { size: 19, color: BLACK })] })],
      }),
      // Level badge
      new TableCell({
        borders: allB,
        width: { size: 900, type: WidthType.DXA },
        shading: { fill: lvlFill, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [b(q.level, { color: lvlCol, size: 18 })], alignment: AlignmentType.CENTER })],
      }),
      // Correct option letter (large)
      new TableCell({
        borders: allB,
        width: { size: 700, type: WidthType.DXA },
        shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [b(correctLetter, { color: WHITE, size: 28 })], alignment: AlignmentType.CENTER })],
      }),
      // Correct answer text (short)
      new TableCell({
        borders: allB,
        width: { size: 2880, type: WidthType.DXA },
        shading: { fill: idx%2===0 ? WHITE : GREY, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ children: [b(correctText, { color: GREEN, size: 21 })] })],
      }),
      // All 4 options recap
      new TableCell({
        borders: allB,
        width: { size: 2320, type: WidthType.DXA },
        shading: { fill: idx%2===0 ? WHITE : GREY, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 100, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: q.options.map((opt, oi) => new Paragraph({
          children: [
            b(`${OPT_LABELS[oi]}.  `, { color: OPT_LABELS[oi]===correctLetter ? GREEN : '888888', size: 17, bold: OPT_LABELS[oi]===correctLetter }),
            r(opt, { size: 17, color: OPT_LABELS[oi]===correctLetter ? GREEN : '888888', bold: OPT_LABELS[oi]===correctLetter }),
          ],
          spacing: { before: 20, after: 20 },
        })),
      }),
    ],
  });
});

const partBChildren = [
  new Paragraph({
    children: [b('PART B  —  ANSWER KEY', { size: 40, color: WHITE })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }),
  new Paragraph({
    children: [b('FOR EVALUATOR USE ONLY  —  DO NOT SHARE WITH CANDIDATE', { size: 20, color: DARK_BLUE })],
    shading: { fill: YELLOW, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }),

  blk(),

  new Paragraph({
    children: [
      b('Marking Guide:  ', { color: DARK_BLUE, size: 20 }),
      r('Award 1 mark for each correct answer. No partial marks. No negative marking. Correct answers are highlighted in ', { size: 20, color: BLACK }),
      b('green', { color: GREEN, size: 20 }),
      r(' below.', { size: 20, color: BLACK }),
    ],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 16, color: MID_BLUE, space: 6 } },
    indent: { left: 200, right: 200 },
    spacing: { before: 80, after: 120 },
  }),

  // ── Answer table ───────────────────────────────────────────────────────
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [560, 2000, 900, 700, 2880, 2320],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hdrCell('Q #',     560),
          hdrCell('Topic',   2000),
          hdrCell('Level',   900),
          hdrCell('Ans',     700),
          hdrCell('Correct Answer Text', 2880),
          hdrCell('All Options',         2320),
        ],
      }),
      ...answerRows,
    ],
  }),

  blk(),

  // Score summary box
  new Paragraph({
    children: [b('Quick Score Reference', { size: 24, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: { before: 120, after: 80 },
  }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [1872, 1872, 1872, 1872, 1872],
    rows: [
      new TableRow({ children: [
        hdrCell('Score Range', 1872),
        hdrCell('Grade',       1872),
        hdrCell('Result',      1872),
        hdrCell('Out of 15',   1872),
        hdrCell('Percentage',  1872),
      ]}),
      ...[
        ['14 – 15', 'A', 'Excellent',            '14–15', '93–100%'],
        ['12 – 13', 'B', 'Good',                 '12–13', '80–86%'],
        ['9 – 11',  'C', 'Satisfactory',         '9–11',  '60–73%'],
        ['6 – 8',   'D', 'Needs Re-Training',    '6–8',   '40–53%'],
        ['0 – 5',   'F', 'Re-Training Required', '0–5',   'Below 40%'],
      ].map(([range, grade, result2, out, pct], i) =>
        new TableRow({ children: [
          cell(range,  1872, i%2===0?WHITE:GREY, true,  DARK_BLUE, AlignmentType.CENTER),
          cell(grade,  1872, i%2===0?WHITE:GREY, true,  MID_BLUE,  AlignmentType.CENTER),
          cell(result2,1872, i%2===0?WHITE:GREY, false, BLACK),
          cell(out,    1872, i%2===0?WHITE:GREY, false, BLACK, AlignmentType.CENTER),
          cell(pct,    1872, i%2===0?WHITE:GREY, false, BLACK, AlignmentType.CENTER),
        ]})
      ),
    ],
  }),

  blk(),

  // Evaluator sign-off
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [3120, 3120, 3120],
    rows: [
      new TableRow({ children: [
        hdrCell('Candidate',     3120),
        hdrCell('Evaluator',     3120),
        hdrCell('Final Score',   3120),
      ]}),
      new TableRow({ children: [
        cell([b('Name: ', { color: DARK_BLUE, size: 20 }), r('_______________________', { size: 20 })], 3120, WHITE),
        cell([b('Name: ', { color: DARK_BLUE, size: 20 }), r('_______________________', { size: 20 })], 3120, WHITE),
        cell([b('Score:  ', { color: DARK_BLUE, size: 20 }), r('_______ / 15', { size: 22, bold: true, color: DARK_BLUE })], 3120, PALE_BLUE),
      ]}),
      new TableRow({ children: [
        cell([b('Sign: ', { color: DARK_BLUE, size: 20 }), r('________________________', { size: 20 })], 3120, GREY),
        cell([b('Sign: ', { color: DARK_BLUE, size: 20 }), r('________________________', { size: 20 })], 3120, GREY),
        cell([b('Date: ', { color: DARK_BLUE, size: 20 }), r('_______________________', { size: 20 })], 3120, GREY),
      ]}),
    ],
  }),

  blk(),
  new Paragraph({
    children: [r('MHS Marketing Dashboard  |  MCQ Evaluation v1.0  |  June 2026  |  My Health School  |  info@myhealthschool.in',
      { size: 17, color: '999999', italics: true })],
    alignment: AlignmentType.CENTER,
  }),
];

// ════════════════════════════════════════════════════════════════════════════
// BUILD DOCUMENT
// ════════════════════════════════════════════════════════════════════════════
const pageProps = {
  size: { width: 12240, height: 15840 },
  margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
};

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22, color: BLACK } } },
  },
  sections: [
    // Cover — no header/footer
    { properties: { page: pageProps }, children: coverChildren },
    // Part A
    {
      properties: { page: pageProps },
      headers: { default: makeHeader('Part A — Question Paper') },
      footers: { default: makeFooter() },
      children: partAChildren,
    },
    // Part B
    {
      properties: { page: pageProps },
      headers: { default: makeHeader('Part B — Answer Key  (Evaluator Only)') },
      footers: { default: makeFooter() },
      children: partBChildren,
    },
  ],
});

const outPath = path.join(__dirname, 'MHS_Dashboard_MCQ_Evaluation.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\nSUCCESS: ${outPath}`);
  console.log(`File size: ${kb} KB`);
}).catch(err => { console.error('ERROR:', err.message); process.exit(1); });
