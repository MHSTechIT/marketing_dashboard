/**
 * MHS Marketing Dashboard — Client KT Evaluation Generator
 * Creates: Part A (Question Paper) + Part B (Answer Key) + Part C (Score Sheet)
 */

const fs = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat,
  TabStopType, TabStopPosition,
} = require('docx');

// ── Palette ─────────────────────────────────────────────────────────────────
const DARK_BLUE   = '1F3864';
const MID_BLUE    = '2E75B6';
const LIGHT_BLUE  = 'D6E4F0';
const PALE_BLUE   = 'EBF3FB';
const ACCENT      = '4472C4';
const GREEN       = '1E7B34';
const PALE_GREEN  = 'E2F0D9';
const ORANGE      = 'C55A11';
const PALE_ORANGE = 'FCE4D6';
const RED         = 'C00000';
const PALE_RED    = 'FCE4E4';
const YELLOW_BG   = 'FFF2CC';
const GREY_BG     = 'F2F2F2';
const WHITE       = 'FFFFFF';
const BLACK       = '1A1A1A';

const W = 9360; // content width in DXA (US Letter, 1" margins)

// ── Shared border/table helpers ──────────────────────────────────────────────
const thinBorder  = { style: BorderStyle.SINGLE, size: 1,  color: 'CCCCCC' };
const midBorder   = { style: BorderStyle.SINGLE, size: 4,  color: MID_BLUE  };
const thickBorder = { style: BorderStyle.SINGLE, size: 8,  color: DARK_BLUE };
const borders     = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const noBorder    = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders   = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ── Text helpers ─────────────────────────────────────────────────────────────
const run  = (text, opts={}) => new TextRun({ text, font: 'Calibri', ...opts });
const bold = (text, opts={}) => run(text, { bold: true, ...opts });

// ── Paragraph helpers ────────────────────────────────────────────────────────
const p = (children, opts={}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
const sp = (before=120, after=120) => ({ before, after });
const blankLine = () => p([run('')], { spacing: sp(60,60) });

// ── Shaded info box ──────────────────────────────────────────────────────────
function infoBox(textRuns, fillColor=PALE_BLUE, leftColor=MID_BLUE) {
  return new Paragraph({
    children: Array.isArray(textRuns) ? textRuns : [run(textRuns)],
    shading: { fill: fillColor, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 16, color: leftColor, space: 6 } },
    indent: { left: 240, right: 240 },
    spacing: sp(80, 80),
  });
}

// ── Answer lines (dotted lines for writing) ──────────────────────────────────
function answerLines(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(new Paragraph({
      children: [run('', { size: 22 })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA', space: 1 } },
      spacing: { before: 0, after: 200 },
    }));
  }
  return lines;
}

// ── Section divider ──────────────────────────────────────────────────────────
function divider(color=MID_BLUE) {
  return new Paragraph({
    children: [run('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color, space: 2 } },
    spacing: sp(160, 160),
  });
}

// ── Difficulty badge inline ──────────────────────────────────────────────────
function difficultyRun(level) {
  const map = { EASY: [GREEN, PALE_GREEN], MEDIUM: [ORANGE, PALE_ORANGE], ADVANCED: [RED, PALE_RED] };
  const [color] = map[level] || [MID_BLUE, PALE_BLUE];
  return run(` [${level}] `, { bold: true, color, size: 18 });
}

// ── Marks badge ──────────────────────────────────────────────────────────────
function marksRun(marks) {
  return run(`  [${marks} Marks]`, { bold: true, color: DARK_BLUE, size: 18, italics: true });
}

// ── Question block (Part A) ──────────────────────────────────────────────────
function questionBlock(num, level, topic, questionText, lineCount) {
  const marksMap = { EASY: 2, MEDIUM: 4, ADVANCED: 6 };
  const fillMap  = { EASY: PALE_GREEN, MEDIUM: PALE_ORANGE, ADVANCED: PALE_RED };
  const bordMap  = { EASY: GREEN, MEDIUM: ORANGE, ADVANCED: RED };

  const result = [];

  // Question header box
  result.push(new Paragraph({
    children: [
      bold(`Q${num}.  `, { size: 24, color: DARK_BLUE }),
      bold(`${topic}`, { size: 22, color: DARK_BLUE }),
      difficultyRun(level),
      marksRun(marksMap[level]),
    ],
    shading: { fill: fillMap[level], type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: bordMap[level], space: 6 } },
    indent: { left: 200, right: 200 },
    spacing: sp(200, 60),
  }));

  // Question text
  result.push(new Paragraph({
    children: [run(questionText, { size: 22, color: BLACK })],
    shading: { fill: fillMap[level], type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: bordMap[level], space: 6 } },
    indent: { left: 200, right: 200 },
    spacing: sp(0, 120),
  }));

  // Answer label
  result.push(p([bold('Answer:', { color: MID_BLUE, size: 20 })], { spacing: sp(100, 40), indent: { left: 200 } }));

  // Answer lines
  result.push(...answerLines(lineCount));
  result.push(blankLine());

  return result;
}

// ── Answer key block (Part B) ────────────────────────────────────────────────
function answerBlock(num, level, topic, answerText, markingGuide) {
  const marksMap = { EASY: 2, MEDIUM: 4, ADVANCED: 6 };
  const result = [];

  result.push(new Paragraph({
    children: [
      bold(`Q${num} Answer — `, { size: 24, color: WHITE }),
      run(`${topic}`, { size: 22, color: WHITE }),
      run(`  [${level} | ${marksMap[level]} Marks]`, { size: 18, color: LIGHT_BLUE, italics: true }),
    ],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    indent: { left: 200, right: 200 },
    spacing: sp(200, 80),
  }));

  // Answer text — split by newlines into paragraphs
  const lines = answerText.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (/^\d+\.\s/.test(line)) {
      result.push(new Paragraph({
        numbering: { reference: 'ans-numbers', level: 0 },
        children: [run(line.replace(/^\d+\.\s/, ''), { size: 21, color: BLACK })],
        spacing: sp(40, 40),
      }));
    } else if (/^[-*]\s/.test(line)) {
      result.push(new Paragraph({
        numbering: { reference: 'ans-bullets', level: 0 },
        children: [run(line.replace(/^[-*]\s/, ''), { size: 21, color: BLACK })],
        spacing: sp(40, 40),
      }));
    } else {
      result.push(new Paragraph({
        children: [run(line, { size: 21, color: BLACK })],
        indent: { left: 200, right: 200 },
        spacing: sp(60, 60),
      }));
    }
  }

  // Marking guide
  if (markingGuide) {
    result.push(blankLine());
    result.push(infoBox(
      [bold('Marking Guide: ', { color: DARK_BLUE, size: 20 }), run(markingGuide, { size: 20, color: '444444' })],
      YELLOW_BG, ORANGE
    ));
  }

  result.push(blankLine());
  result.push(divider());
  return result;
}

// ── Simple cell helper ───────────────────────────────────────────────────────
function cell(children, w, fill=WHITE, bold_=false, color=BLACK, align=AlignmentType.LEFT, vAlign=VerticalAlign.CENTER) {
  return new TableCell({
    borders,
    width: { size: w, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: vAlign,
    children: [new Paragraph({
      children: Array.isArray(children)
        ? children
        : [new TextRun({ text: String(children), font: 'Calibri', bold: bold_, color, size: 20 })],
      alignment: align,
    })],
  });
}
function hdrCell(text, w, fill=DARK_BLUE) {
  return cell(text, w, fill, true, WHITE, AlignmentType.CENTER, VerticalAlign.CENTER);
}

// ── Header / Footer factories ────────────────────────────────────────────────
function makeHeader(title) {
  return new Header({
    children: [new Paragraph({
      children: [
        run('MHS Marketing Dashboard  |  ', { bold: true, color: MID_BLUE, size: 18 }),
        run(title, { color: '555555', size: 18 }),
        run('\t', { size: 18 }),
        run('Confidential — My Health School', { color: 'AAAAAA', size: 16, italics: true }),
      ],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE, space: 2 } },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    })],
  });
}

function makeFooter() {
  return new Footer({
    children: [new Paragraph({
      children: [
        run('© 2026 My Health School  |  info@myhealthschool.in', { color: 'AAAAAA', size: 16 }),
        run('\t', { size: 16 }),
        run('Page ', { color: '888888', size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', color: MID_BLUE, size: 16 }),
        run(' of ', { color: '888888', size: 16 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', color: MID_BLUE, size: 16 }),
      ],
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE, space: 2 } },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    })],
  });
}

// ════════════════════════════════════════════════════════════════════════════
// COVER PAGE CONTENT
// ════════════════════════════════════════════════════════════════════════════
const coverChildren = [
  p([run('')], { spacing: sp(1800, 0) }),

  // Top accent bar
  new Paragraph({
    children: [run(' ', { size: 4 })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    spacing: sp(0, 0),
  }),

  p([run('')], { spacing: sp(400, 0) }),

  p([bold('MY HEALTH SCHOOL', { size: 28, color: MID_BLUE, allCaps: true })],
    { alignment: AlignmentType.CENTER, spacing: sp(0, 80) }),

  p([bold('MHS Marketing Dashboard', { size: 64, color: DARK_BLUE })],
    { alignment: AlignmentType.CENTER, spacing: sp(120, 80) }),

  p([bold('Client Knowledge Transfer Evaluation', { size: 48, color: MID_BLUE })],
    { alignment: AlignmentType.CENTER, spacing: sp(0, 60) }),

  p([run('Post-KT Assessment — MHS Marketing Dashboard', { size: 28, color: '666666', italics: true })],
    { alignment: AlignmentType.CENTER, spacing: sp(0, 480) }),

  // Bottom accent bar
  new Paragraph({
    children: [run(' ', { size: 4 })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    spacing: sp(0, 0),
  }),

  p([run('')], { spacing: sp(360, 0) }),

  // Info table
  new Table({
    width: { size: 7200, type: WidthType.DXA },
    columnWidths: [2400, 4800],
    rows: [
      new TableRow({ children: [
        cell('Document Type', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('Client Evaluation — Knowledge Transfer Assessment', 4800, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Application', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('MHS Marketing Dashboard', 4800, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Version', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('1.0 — June 2026', 4800, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Total Questions', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('15 Questions (Easy: 5 | Medium: 5 | Advanced: 5)', 4800, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Total Marks', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('60 Marks', 4800, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Duration', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('45 – 60 Minutes (Recommended)', 4800, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Confidentiality', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('Confidential — My Health School Internal Document', 4800, WHITE),
      ]}),
    ],
  }),

  p([run('')], { spacing: sp(360, 0) }),
  p([run('info@myhealthschool.in', { size: 22, color: MID_BLUE })],
    { alignment: AlignmentType.CENTER, spacing: sp(0, 60) }),

  p([run('Contains: Part A — Question Paper  |  Part B — Answer Key  |  Part C — Score Sheet', {
    size: 20, color: '888888', italics: true,
  })], { alignment: AlignmentType.CENTER, spacing: sp(0, 0) }),

  p([new PageBreak()]),
];

// ════════════════════════════════════════════════════════════════════════════
// PART A — QUESTION PAPER
// ════════════════════════════════════════════════════════════════════════════

const partAChildren = [
  // Part A Header
  new Paragraph({
    children: [bold('PART A — QUESTION PAPER', { size: 44, color: WHITE })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(0, 0),
  }),
  new Paragraph({
    children: [run('For Candidate Use   |   Do NOT refer to notes or the User Manual during this assessment', { size: 20, color: WHITE, italics: true })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(0, 0),
  }),
  blankLine(),

  // Instructions box
  new Paragraph({
    children: [bold('Instructions to Candidate', { size: 24, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 60),
  }),
  ...[
    '1.  This paper contains 15 questions divided into three difficulty levels.',
    '2.  Easy questions carry 2 marks each (Q1–Q5).',
    '3.  Medium questions carry 4 marks each (Q6–Q10).',
    '4.  Advanced questions carry 6 marks each (Q11–Q15).',
    '5.  Total marks: 60.  Recommended duration: 45–60 minutes.',
    '6.  Write your answers clearly in the space provided below each question.',
    '7.  All questions are compulsory. There are no optional questions.',
    '8.  You may use the MHS Marketing Dashboard application for reference where indicated.',
  ].map(line => new Paragraph({
    children: [run(line, { size: 21, color: BLACK })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 240, right: 200 },
    spacing: sp(40, 40),
  })),
  blankLine(),

  // Candidate info table
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2400, 4560, 2400],
    rows: [new TableRow({ children: [
      cell([bold('Candidate Name:', { color: DARK_BLUE, size: 20 }), run('  ____________________________', { size: 20 })], 2400, PALE_BLUE),
      cell([bold('Date:', { color: DARK_BLUE, size: 20 }), run('  ______________________________', { size: 20 })], 4560, PALE_BLUE),
      cell([bold('Score:', { color: DARK_BLUE, size: 20 }), run('  ______ / 60', { size: 20 })], 2400, PALE_BLUE),
    ]})],
  }),

  blankLine(), divider(), blankLine(),

  // Section: EASY
  new Paragraph({
    children: [bold('SECTION 1: EASY QUESTIONS', { size: 30, color: WHITE })],
    shading: { fill: GREEN, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(120, 60),
  }),
  p([run('Questions 1–5  |  2 Marks each  |  Total: 10 Marks', { size: 20, color: '555555', italics: true })],
    { alignment: AlignmentType.CENTER, spacing: sp(60, 120) }),

  ...questionBlock(1, 'EASY', 'Login & Browser Access',
    'What is the URL used to access the MHS Marketing Dashboard login page, and which web browsers are recommended for use? Name at least three supported browsers and one browser that is NOT supported.',
    4),

  ...questionBlock(2, 'EASY', 'User Roles',
    'What are the three user roles available in the MHS Marketing Dashboard? Briefly describe what each role can access and what responsibilities each role has.',
    5),

  ...questionBlock(3, 'EASY', 'Advertising Metrics — CPL',
    'What does the abbreviation "CPL" stand for in the Ads Analytics Dashboard? What does it measure, and how is it calculated? What does a lower CPL value indicate?',
    4),

  ...questionBlock(4, 'EASY', 'Lead Sync Frequency',
    'How frequently does the system automatically sync leads from Meta lead forms into the dashboard? If a user needs an immediate sync without waiting, what should they do?',
    3),

  ...questionBlock(5, 'EASY', 'Theme Switching',
    'How do you switch between Light Mode and Dark Mode in the MHS Marketing Dashboard? Where is the toggle located, and is the preference remembered after you log out?',
    3),

  blankLine(), divider(), blankLine(),

  // Section: MEDIUM
  new Paragraph({
    children: [bold('SECTION 2: MEDIUM QUESTIONS', { size: 30, color: WHITE })],
    shading: { fill: ORANGE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(120, 60),
  }),
  p([run('Questions 6–10  |  4 Marks each  |  Total: 20 Marks', { size: 20, color: '555555', italics: true })],
    { alignment: AlignmentType.CENTER, spacing: sp(60, 120) }),

  ...questionBlock(6, 'MEDIUM', 'Hook Rate & Hold Rate',
    'Explain what "Hook Rate" and "Hold Rate" mean as advertising metrics in the dashboard. Why are these two metrics critically important for evaluating the performance of video ads and Reels?',
    6),

  ...questionBlock(7, 'MEDIUM', 'Exporting Leads',
    'A team member needs to export all leads collected in the last 30 days. Describe the complete step-by-step process they should follow within the dashboard to accomplish this task.',
    6),

  ...questionBlock(8, 'MEDIUM', 'Wix Analytics Date Limit',
    'What is the maximum date range supported by Wix Analytics data in the dashboard? What error or behaviour occurs if a user selects a wider date range? How should this be handled?',
    5),

  ...questionBlock(9, 'MEDIUM', 'Restricted User Permissions',
    'As an Admin, you want to give a new team member access ONLY to the Reels analytics page and nothing else. Describe the exact step-by-step process to create the account and configure the permissions correctly.',
    7),

  ...questionBlock(10, 'MEDIUM', 'Campaign Saturation Alert',
    'The Ads Analytics Dashboard shows a "Campaign Saturation" alert banner at the top of the page. What does this alert mean, what system is generating it, and what actions should the marketing manager take in response?',
    6),

  blankLine(), divider(), blankLine(),

  // Section: ADVANCED
  new Paragraph({
    children: [bold('SECTION 3: ADVANCED QUESTIONS', { size: 30, color: WHITE })],
    shading: { fill: RED, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(120, 60),
  }),
  p([run('Questions 11–15  |  6 Marks each  |  Total: 30 Marks', { size: 20, color: '555555', italics: true })],
    { alignment: AlignmentType.CENTER, spacing: sp(60, 120) }),

  ...questionBlock(11, 'ADVANCED', 'Meta Token Expiry — Recovery Process',
    'The Meta Access Token has expired and the leads table is now showing a permission error. As an Admin, describe the COMPLETE step-by-step process to restore leads syncing functionality, including what permissions the new token must have and how to prevent this issue in future.',
    10),

  ...questionBlock(12, 'ADVANCED', 'User Token vs Page Token',
    'Explain the technical difference between a "User Access Token" and a "System/Page Token" in the context of Meta API integration. Why does the "No forms found for this page" error occur, and what is the exact resolution process?',
    10),

  ...questionBlock(13, 'ADVANCED', 'Creative Fatigue — Analysis & Action',
    'A campaign\'s Creative Fatigue Score is showing as HIGH in the AI Insights page. What does this mean technically (which metrics trigger this)? What specific actions should the creative team and the media buying team each take in response?',
    10),

  ...questionBlock(14, 'ADVANCED', 'Database Architecture — PostgreSQL vs Supabase',
    'The dashboard uses two separate databases — PostgreSQL and Supabase. Explain the specific purpose of each database in the system. What data would be permanently LOST if the Supabase connection failed? What would NOT be affected?',
    10),

  ...questionBlock(15, 'ADVANCED', 'Multi-User Onboarding Scenario',
    'You are onboarding 3 new team members: (a) a Digital Marketing Manager who needs full analytics and lead access but must NOT manage user accounts, (b) a Content Creator who only needs access to Reels and Audience pages, (c) a System Admin who manages everything. For each person — state the role to assign, describe the exact permission configuration steps, and explain why.',
    12),

  p([new PageBreak()]),
];

// ════════════════════════════════════════════════════════════════════════════
// PART B — ANSWER KEY
// ════════════════════════════════════════════════════════════════════════════

const partBChildren = [
  new Paragraph({
    children: [bold('PART B — ANSWER KEY', { size: 44, color: WHITE })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(0, 0),
  }),
  new Paragraph({
    children: [bold('FOR EVALUATOR USE ONLY — DO NOT DISTRIBUTE TO CANDIDATE', { size: 22, color: DARK_BLUE })],
    shading: { fill: YELLOW_BG, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(0, 0),
  }),
  blankLine(),

  infoBox([
    bold('How to use this Answer Key:  ', { color: DARK_BLUE, size: 20 }),
    run('Award marks proportionally for partially correct answers. Accept equivalent phrasing — candidates do not need to use exact words. Use the Marking Guide below each answer for awarding partial credit.', { size: 20 }),
  ], PALE_BLUE, MID_BLUE),

  blankLine(),

  ...answerBlock(1, 'EASY', 'Login & Browser Access',
    'The login page is accessed at the /login route of the application base URL (e.g. http://localhost:3001/login for local, or the deployed URL/login for production).\nRecommended browsers:\n1. Google Chrome (version 90 or later) — Recommended\n2. Mozilla Firefox (version 88 or later)\n3. Microsoft Edge (version 90 or later)\n4. Safari (version 14 or later, macOS and iOS)\nNOT supported: Internet Explorer (any version).',
    'Award 1 mark for correct URL format (/login). Award 1 mark for naming at least 3 correct browsers. Bonus: mentioning IE is unsupported is a positive sign.'
  ),

  ...answerBlock(2, 'EASY', 'User Roles',
    'Three user roles in the MHS Marketing Dashboard:\n1. Admin — Full unrestricted access to ALL modules, user management, Manage Permissions, Meta Settings, and server configuration. Responsible for token renewal, adding/removing users, and permission assignment.\n2. Manager / Team Member — Access to all analytics modules, leads data, AI Insights, and content performance. Cannot access Team Management or change user permissions.\n3. Restricted User — Access limited to only the specific modules explicitly enabled by an Admin via the Manage Permissions page. All modules are OFF by default until enabled.',
    'Award 2 marks for correctly naming all 3 roles. Deduct 0.5 if a role is missing or significantly misdescribed. Accept "standard user" or "team member" for Manager role.'
  ),

  ...answerBlock(3, 'EASY', 'Advertising Metrics — CPL',
    'CPL = Cost Per Lead.\nIt measures the average amount of advertising spend required to generate one lead.\nFormula: Total Ad Spend divided by Total Number of Leads.\nA lower CPL value indicates more efficient lead generation — the campaign is acquiring leads at a lower cost, which is desirable.',
    'Award 1 mark for correct expansion of CPL. Award 0.5 for correct definition. Award 0.5 for formula or example.'
  ),

  ...answerBlock(4, 'EASY', 'Lead Sync Frequency',
    'The system automatically syncs leads from Meta lead forms every 5 minutes via a background scheduler running on the server.\nFor an immediate on-demand sync, the user should click the "Sync All Leads" button on the Dashboards (Ads Analytics) page. This triggers an immediate sync without waiting for the next scheduled run.',
    'Award 1 mark for "every 5 minutes." Award 1 mark for naming the "Sync All Leads" button and its location.'
  ),

  ...answerBlock(5, 'EASY', 'Theme Switching',
    'The theme toggle is located in the top bar/header area of the dashboard. Click the theme toggle icon (sun icon for Light Mode, moon icon for Dark Mode) in the ThemeBar/header.\nThe selected theme preference is saved in the browser\'s local storage, so it persists across page refreshes. However, it is browser-specific and may not persist if local storage is cleared or a different browser/device is used.',
    'Award 1 mark for identifying the header/top bar location. Award 1 mark for mentioning local storage persistence.'
  ),

  ...answerBlock(6, 'MEDIUM', 'Hook Rate & Hold Rate',
    'Hook Rate: The percentage of people who watched the first 3 seconds of a video ad after seeing it in their feed. It measures how effectively the opening frame of the ad "hooks" the viewer\'s attention and stops them scrolling.\nHold Rate: The percentage of people who continued watching beyond the first 3 seconds (i.e. watched more of the ad after being hooked). It measures how well the ad retains viewer attention once they have started watching.\nWhy they matter:\n- A low Hook Rate means the ad is failing to stop the scroll — the thumbnail, first frame, or opening line needs to be redesigned.\n- A low Hold Rate means viewers start watching but quickly lose interest — the ad\'s message, pacing, or relevance needs improvement.\n- Together, these metrics help diagnose exactly WHERE a video creative is failing and guide the creative team\'s next iteration.',
    'Award 2 marks for correct definitions of both (1 each). Award 2 marks for explaining their diagnostic importance. Partial credit: 1 mark if only one metric is correctly explained.'
  ),

  ...answerBlock(7, 'MEDIUM', 'Exporting Leads',
    'Step-by-step process to export leads for the last 30 days:\n1. Log in to the MHS Marketing Dashboard.\n2. Click "Unique Leads" in the left sidebar navigation.\n3. Locate the Date Range filter (top of the page).\n4. Select "Last 30 Days" from the date range preset options (or set a custom start/end date covering the last 30 days).\n5. Apply any additional filters if needed (e.g., by lead source, quality score, campaign).\n6. Click the Export or Download button (CSV export icon/button) on the Unique Leads page.\n7. The file will download to the device as a CSV file containing all lead records (name, phone number, source, date, quality score, campaign) for the selected date range.',
    'Award 1 mark per clearly correct step (max 4 marks). Must include: navigating to Unique Leads, setting date filter to 30 days, clicking export. Deduct 1 if the export format (CSV) is wrong.'
  ),

  ...answerBlock(8, 'MEDIUM', 'Wix Analytics Date Limit',
    'The Wix Analytics API supports a maximum date range of 62 days. If a user selects a date range wider than 62 days (e.g. Last 90 Days, Last Quarter, or a custom range spanning more than 62 days), the Wix API will return an error. As a result, all Wix-sourced metrics (website sessions, unique visitors, form submissions, form views, lead count) will fail to load or display an error state on the Ads Analytics Dashboard. Importantly, Meta Ads data will still display normally since it is not subject to the Wix limitation.\nResolution: Limit the date range to 62 days or fewer whenever viewing data that includes Wix analytics.',
    'Award 2 marks for correctly stating the 62-day limit. Award 1 mark for describing the error behaviour. Award 1 mark for stating that Meta data is unaffected and/or the fix.'
  ),

  ...answerBlock(9, 'MEDIUM', 'Restricted User Permissions',
    'Step-by-step process:\n1. Log in as an Admin.\n2. Navigate to Settings > Team Management from the sidebar.\n3. Click "Add New User" or the equivalent button.\n4. Enter the new team member\'s name, email address, and a temporary password.\n5. Set their Role to "Restricted" (not Manager or Admin).\n6. Save the new user account.\n7. Navigate to Settings > Manage Permissions.\n8. Find the new team member in the user list.\n9. All module toggles will be set to OFF by default for Restricted users.\n10. Enable ONLY the toggle for "Best Performing Reel" (the Reels Analytics module).\n11. Leave ALL other module toggles OFF.\n12. Save/confirm the permission settings.\nResult: When the team member logs in, they will see only the Reels Analytics page in their navigation. All other pages will be hidden or inaccessible.',
    'Award 1 mark for creating the account as Restricted role. Award 1 mark for navigating to Manage Permissions. Award 1 mark for enabling ONLY the Reels toggle. Award 1 mark for confirming all others remain OFF.'
  ),

  ...answerBlock(10, 'MEDIUM', 'Campaign Saturation Alert',
    'What the alert means: The Campaign Saturation alert is generated by the AI Insights module (powered by Google Gemini AI). It indicates that one or more active campaigns have reached audience saturation — the target audience has been exposed to the same ad creative too many times, resulting in diminishing engagement, rising CPM, falling CTR, and decreasing returns on ad spend.\nActions the marketing manager should take:\n1. Click through to the AI Insights page to view the full Lead Saturation Index analysis and identify which specific campaigns are flagged.\n2. Review the Saturation Index score and the signal breakdown for each flagged campaign.\n3. Refresh the creative — produce new ad copy, new visuals, or a new creative angle for the saturated campaigns.\n4. Expand the audience targeting — broaden the audience definition to reach new people who have not yet seen the ads.\n5. Consider pausing the most saturated campaigns temporarily and reallocating their budget to fresher-performing campaigns.\n6. Monitor the AI Insights page again after creative refresh to verify the saturation signal reduces.',
    'Award 1 mark for correctly identifying the AI/Gemini source. Award 1 mark for correct meaning of saturation. Award 2 marks for listing at least 3 correct actions.'
  ),

  ...answerBlock(11, 'ADVANCED', 'Meta Token Expiry — Recovery Process',
    'Complete step-by-step process to restore lead syncing after Meta token expiry:\n1. Open a browser and navigate to Facebook Graph API Explorer at: developers.facebook.com/tools/explorer\n2. Select your Meta App from the app dropdown.\n3. Click "Generate Access Token."\n4. Select the required permissions: leads_retrieval, pages_read_engagement, read_insights, ads_read.\n5. Complete the Facebook login/authorisation flow to generate the token.\n6. Copy the full token string.\n7. On the server, open the file: server/.env\n8. Find the line: META_ACCESS_TOKEN=\n9. Replace the old/expired token value with the new token.\n10. Save the .env file.\n11. Restart the Node.js server (if using nodemon, it will detect the .env change and restart automatically).\n12. Wait up to 5 minutes for the next automatic leads sync cycle.\n13. Navigate to the Unique Leads page — the permission error should be resolved and new leads should appear.\nPrevention: Set a calendar reminder 2 weeks before the 90-day expiry date to renew the token proactively before it expires.',
    'Award 1 mark for Graph API Explorer. Award 1 mark for correct permissions listed. Award 2 marks for correct .env update and server restart steps. Award 1 mark for the 90-day note/prevention. Award 1 mark for verification step.'
  ),

  ...answerBlock(12, 'ADVANCED', 'User Token vs Page Token',
    'User Access Token:\n- Tied to a specific Meta user account (Facebook account).\n- Expires approximately every 90 days.\n- Provides broad access across all pages and ad accounts that the user manages.\n- Required for leads_retrieval permission, which retrieves leads from ALL forms across all connected pages.\nSystem/Page Token (Single-Page Token):\n- Scoped to one specific Facebook Page only.\n- Does NOT have leads_retrieval permission across multiple pages.\n- Even though it may not expire, it cannot access lead forms on other pages.\nWhy "No forms found for this page" occurs:\nThis error occurs when the token configured in server/.env as META_ACCESS_TOKEN is a Page Token or a token without the leads_retrieval permission scope. Because the token is page-scoped, the Meta API cannot find or return lead forms associated with other pages or ad accounts.\nResolution:\n1. Go to Facebook Graph API Explorer.\n2. Generate a USER Access Token (not a Page token) — select "User Token" type.\n3. Ensure leads_retrieval is explicitly included in the permissions.\n4. Update META_ACCESS_TOKEN in server/.env with this User Access Token.\n5. Restart the server.',
    'Award 2 marks for correctly distinguishing User Token vs Page Token. Award 2 marks for explaining why the error occurs (wrong token scope). Award 2 marks for the complete resolution steps.'
  ),

  ...answerBlock(13, 'ADVANCED', 'Creative Fatigue — Analysis & Action',
    'Technical meaning of HIGH Creative Fatigue Score:\nThe AI (Google Gemini) has analysed the campaign\'s ad metrics and determined that the target audience has been overexposed to this specific creative. Technically, this is evidenced by: falling CTR (fewer clicks per impression), rising CPM (increasing cost to reach 1,000 people), declining Hook Rate (fewer people stopping to watch), declining Hold Rate (fewer completing the view), and high frequency (average number of times the audience has seen the same ad).\nCreative Team Actions:\n1. Immediately produce 3–5 new ad creative variations — new visuals, different hooks, updated copy, fresh angles.\n2. Test new formats: if current ads are static images, try video; if video, try a different aspect ratio or narrative style.\n3. Review the Best Performing Ad and Best Performing Reel pages to understand what metrics triggered the fatigue — use this to inform what NOT to repeat in new creatives.\nMedia Buying Team Actions:\n1. Reduce budget on the fatigued ad set immediately to stop wasting spend on a declining creative.\n2. Pause the fatigued creative once new alternatives are ready.\n3. Rotate in the new creatives and monitor Hook Rate and Hold Rate for the first 48–72 hours.\n4. Run A/B tests between the new creatives to identify the winner.',
    'Award 2 marks for correctly identifying the metrics that indicate fatigue (CTR, CPM, Hook Rate, Hold Rate, frequency). Award 2 marks for at least 2 specific creative team actions. Award 2 marks for at least 2 specific media team actions.'
  ),

  ...answerBlock(14, 'ADVANCED', 'Database Architecture — PostgreSQL vs Supabase',
    'PostgreSQL (self-hosted):\n- PRIMARY operational database for the entire application.\n- Stores: all synced leads from Meta lead forms (name, phone, source, date, quality score), campaign data and ad insights cache, sync-state records (timestamp of last sync for each form), user accounts and authentication data, team information and targets.\n- All API routes for leads, campaigns, users, and team data query PostgreSQL.\nSupabase (cloud-hosted PostgreSQL):\n- SECONDARY specialised storage for time-sensitive Instagram data ONLY.\n- Stores: Instagram Stories snapshots — metrics (views, likes, comments, shares, reach) captured by the scheduled background job.\n- WHY Supabase is needed: Meta\'s API only makes Stories data available for approximately 24 hours after a Story is posted. After that, the data is no longer retrievable from Meta. The background scheduler captures this data while it is available and stores it permanently in Supabase so it can be reviewed later.\nIf Supabase connection fails:\n- LOST/AFFECTED: All historical Instagram Stories performance data. The Best Performing Reels page would show no historical story data. New story snapshots would stop being captured and would be permanently lost after 24 hours.\n- NOT AFFECTED: All leads data, campaign analytics, user accounts, team data, and all non-Stories features — these all use PostgreSQL and would continue working normally.',
    'Award 2 marks for correct description of PostgreSQL\'s role. Award 2 marks for correct description of Supabase\'s role and the 24-hour story expiry reason. Award 2 marks for correctly identifying what is lost and what is unaffected if Supabase fails.'
  ),

  ...answerBlock(15, 'ADVANCED', 'Multi-User Onboarding Scenario',
    'Scenario (a) — Digital Marketing Manager:\nRole to assign: Manager (standard team member role).\nReasoning: The Manager role provides full access to all analytics dashboards, leads data, AI Insights, Best Performing Ad, Reels, Audience, Plan, and Reports. By design, Managers cannot access Team Management or Manage Permissions — which is exactly what this user requires.\nPermission config steps: None required. The Manager role has the correct access level by default. Simply create the account via Team Management and assign role = Manager.\nScenario (b) — Content Creator:\nRole to assign: Restricted.\nPermission config steps:\n1. Create account in Team Management with role = Restricted.\n2. Navigate to Manage Permissions.\n3. Find the Content Creator in the list.\n4. Enable ONLY: Best Performing Reel (Reels Analytics) AND Audience Analytics.\n5. Leave all other module toggles OFF.\n6. Save permissions.\nScenario (c) — System Admin:\nRole to assign: Admin.\nReasoning: Admin role provides unrestricted access to all modules including Team Management, Manage Permissions, Meta Settings, and server configuration.\nPermission config steps: None required. Admin role has full access by default. Create the account via Team Management and assign role = Admin.',
    'Award 2 marks per scenario (6 total). For each: 1 mark for correct role, 1 mark for correct permission reasoning/steps. Full marks only if the Manager scenario correctly explains NO extra permission config is needed.'
  ),

  p([new PageBreak()]),
];

// ════════════════════════════════════════════════════════════════════════════
// PART C — SCORE SHEET & EVALUATION TEMPLATE
// ════════════════════════════════════════════════════════════════════════════

// Score table data
const questions = [
  { n:'Q1',  topic:'Login & Browser Access',          diff:'Easy',     marks:2 },
  { n:'Q2',  topic:'User Roles',                       diff:'Easy',     marks:2 },
  { n:'Q3',  topic:'Advertising Metrics — CPL',        diff:'Easy',     marks:2 },
  { n:'Q4',  topic:'Lead Sync Frequency',              diff:'Easy',     marks:2 },
  { n:'Q5',  topic:'Theme Switching',                  diff:'Easy',     marks:2 },
  { n:'Q6',  topic:'Hook Rate & Hold Rate',            diff:'Medium',   marks:4 },
  { n:'Q7',  topic:'Exporting Leads',                  diff:'Medium',   marks:4 },
  { n:'Q8',  topic:'Wix Analytics Date Limit',         diff:'Medium',   marks:4 },
  { n:'Q9',  topic:'Restricted User Permissions',      diff:'Medium',   marks:4 },
  { n:'Q10', topic:'Campaign Saturation Alert',        diff:'Medium',   marks:4 },
  { n:'Q11', topic:'Meta Token Recovery',             diff:'Advanced',  marks:6 },
  { n:'Q12', topic:'User Token vs Page Token',         diff:'Advanced',  marks:6 },
  { n:'Q13', topic:'Creative Fatigue Analysis',        diff:'Advanced',  marks:6 },
  { n:'Q14', topic:'Database Architecture',           diff:'Advanced',  marks:6 },
  { n:'Q15', topic:'Multi-User Onboarding',           diff:'Advanced',  marks:6 },
];

const diffColor = { Easy: GREEN, Medium: ORANGE, Advanced: RED };
const diffBg    = { Easy: PALE_GREEN, Medium: PALE_ORANGE, Advanced: PALE_RED };

// Build score rows
const scoreRows = questions.map((q, i) => new TableRow({
  children: [
    cell(q.n,    840, i%2===0?WHITE:GREY_BG, true,  DARK_BLUE, AlignmentType.CENTER),
    cell(q.topic,3600,i%2===0?WHITE:GREY_BG, false, BLACK),
    cell(q.diff, 1200,diffBg[q.diff],        true,  diffColor[q.diff], AlignmentType.CENTER),
    cell(String(q.marks), 720, i%2===0?WHITE:GREY_BG, true, DARK_BLUE, AlignmentType.CENTER),
    cell('',     1200,i%2===0?WHITE:GREY_BG, false, BLACK, AlignmentType.CENTER),
    cell('',     1800,i%2===0?WHITE:GREY_BG, false, BLACK),
  ],
}));

// Subtotal rows
const easySubtotal   = new TableRow({ children: [
  cell('',   840,  PALE_GREEN, false, BLACK),
  cell('Easy Subtotal (Q1–Q5)', 3600, PALE_GREEN, true, GREEN),
  cell('',   1200, PALE_GREEN),
  cell('10', 720,  PALE_GREEN, true, GREEN, AlignmentType.CENTER),
  cell('',   1200, PALE_GREEN, false, BLACK, AlignmentType.CENTER),
  cell('',   1800, PALE_GREEN),
]});
const medSubtotal    = new TableRow({ children: [
  cell('',   840,  PALE_ORANGE, false, BLACK),
  cell('Medium Subtotal (Q6–Q10)', 3600, PALE_ORANGE, true, ORANGE),
  cell('',   1200, PALE_ORANGE),
  cell('20', 720,  PALE_ORANGE, true, ORANGE, AlignmentType.CENTER),
  cell('',   1200, PALE_ORANGE, false, BLACK, AlignmentType.CENTER),
  cell('',   1800, PALE_ORANGE),
]});
const advSubtotal    = new TableRow({ children: [
  cell('',   840,  PALE_RED, false, BLACK),
  cell('Advanced Subtotal (Q11–Q15)', 3600, PALE_RED, true, RED),
  cell('',   1200, PALE_RED),
  cell('30', 720,  PALE_RED, true, RED, AlignmentType.CENTER),
  cell('',   1200, PALE_RED, false, BLACK, AlignmentType.CENTER),
  cell('',   1800, PALE_RED),
]});
const totalRow = new TableRow({ children: [
  cell('',   840,  DARK_BLUE, false, WHITE),
  cell('GRAND TOTAL', 3600, DARK_BLUE, true, WHITE),
  cell('',   1200, DARK_BLUE),
  cell('60', 720,  DARK_BLUE, true, WHITE, AlignmentType.CENTER),
  cell('',   1200, DARK_BLUE, false, WHITE, AlignmentType.CENTER),
  cell('',   1800, DARK_BLUE),
]});

const gradeRows = [
  ['54 – 60', 'A', 'Excellent', 'Full system proficiency. Ready for independent operation.', GREEN],
  ['42 – 53', 'B', 'Good', 'Strong understanding. Minor gaps — self-remediation sufficient.', '0070C0'],
  ['30 – 41', 'C', 'Satisfactory', 'Basic understanding. Recommend targeted re-training on weak areas.', ORANGE],
  ['18 – 29', 'D', 'Needs Improvement', 'Significant gaps. Structured re-training session required.', 'C55A11'],
  ['Below 18','F', 'Re-Training Required', 'Insufficient understanding. Full KT session must be repeated.', RED],
].map(([range, grade, label, desc, color], i) => new TableRow({
  children: [
    cell(range, 1500, i%2===0?WHITE:GREY_BG, true, color, AlignmentType.CENTER),
    cell(grade, 600,  i%2===0?WHITE:GREY_BG, true, color, AlignmentType.CENTER),
    cell(label, 2100, i%2===0?WHITE:GREY_BG, true, color),
    cell(desc,  5160, i%2===0?WHITE:GREY_BG, false, BLACK),
  ],
}));

const partCChildren = [
  new Paragraph({
    children: [bold('PART C — SCORE SHEET & EVALUATION TEMPLATE', { size: 44, color: WHITE })],
    shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(0, 0),
  }),
  new Paragraph({
    children: [run('For Evaluator Use Only   |   Complete After Assessment', { size: 20, color: WHITE, italics: true })],
    shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
    alignment: AlignmentType.CENTER,
    spacing: sp(0, 0),
  }),
  blankLine(),

  // Candidate info
  new Paragraph({
    children: [bold('Candidate & Session Information', { size: 26, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 80),
  }),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2400, 4560, 2400],
    rows: [
      new TableRow({ children: [
        cell('Candidate Name', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('', 4560, WHITE),
        cell('', 2400, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Designation / Role', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('', 4560, WHITE),
        cell('Assessment Date', 2400, PALE_BLUE, true, DARK_BLUE),
      ]}),
      new TableRow({ children: [
        cell('Evaluator Name', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('', 4560, WHITE),
        cell('Duration Taken', 2400, PALE_BLUE, true, DARK_BLUE),
      ]}),
      new TableRow({ children: [
        cell('Organisation', 2400, PALE_BLUE, true, DARK_BLUE),
        cell('My Health School (MHS)', 4560, GREY_BG, false, '555555'),
        cell('Application', 2400, PALE_BLUE, true, DARK_BLUE),
      ]}),
    ],
  }),

  blankLine(),

  // Score table header
  new Paragraph({
    children: [bold('Question-wise Score Record', { size: 26, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 80),
  }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [840, 3600, 1200, 720, 1200, 1800],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hdrCell('Q #',   840),
          hdrCell('Topic / Module', 3600),
          hdrCell('Level',  1200),
          hdrCell('Max',    720),
          hdrCell('Score',  1200),
          hdrCell('Evaluator Comments', 1800),
        ],
      }),
      // Q1-Q5
      ...scoreRows.slice(0, 5),
      easySubtotal,
      // Q6-Q10
      ...scoreRows.slice(5, 10),
      medSubtotal,
      // Q11-Q15
      ...scoreRows.slice(10, 15),
      advSubtotal,
      totalRow,
    ],
  }),

  blankLine(),

  // Grade scale
  new Paragraph({
    children: [bold('Performance Grade Scale', { size: 26, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 80),
  }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [1500, 600, 2100, 5160],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hdrCell('Score Range', 1500),
          hdrCell('Grade', 600),
          hdrCell('Performance Level', 2100),
          hdrCell('Recommendation', 5160),
        ],
      }),
      ...gradeRows,
    ],
  }),

  blankLine(),

  // Section-wise summary
  new Paragraph({
    children: [bold('Section-wise Performance Summary', { size: 26, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 80),
  }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2160, 1440, 1440, 2160, 2160],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hdrCell('Section', 2160),
          hdrCell('Max Marks', 1440),
          hdrCell('Obtained', 1440),
          hdrCell('Percentage', 2160),
          hdrCell('Proficiency Level', 2160),
        ],
      }),
      new TableRow({ children: [
        cell('Easy (Q1–Q5)',     2160, PALE_GREEN,  true, GREEN),
        cell('10',               1440, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 1440, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 2160, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 2160, WHITE, false, BLACK),
      ]}),
      new TableRow({ children: [
        cell('Medium (Q6–Q10)', 2160, PALE_ORANGE, true, ORANGE),
        cell('20',               1440, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 1440, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 2160, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 2160, WHITE, false, BLACK),
      ]}),
      new TableRow({ children: [
        cell('Advanced (Q11–Q15)', 2160, PALE_RED, true, RED),
        cell('30',               1440, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 1440, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 2160, WHITE, false, BLACK, AlignmentType.CENTER),
        cell('',                 2160, WHITE, false, BLACK),
      ]}),
      new TableRow({ children: [
        cell('TOTAL',            2160, DARK_BLUE, true, WHITE),
        cell('60',               1440, DARK_BLUE, true, WHITE, AlignmentType.CENTER),
        cell('',                 1440, DARK_BLUE, false, WHITE, AlignmentType.CENTER),
        cell('',                 2160, DARK_BLUE, false, WHITE, AlignmentType.CENTER),
        cell('',                 2160, DARK_BLUE, false, WHITE),
      ]}),
    ],
  }),

  blankLine(),

  // Evaluator observations
  new Paragraph({
    children: [bold('Evaluator Observations & Recommendations', { size: 26, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 80),
  }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [2880, 6480],
    rows: [
      new TableRow({ children: [
        cell('Strong Areas', 2880, PALE_BLUE, true, DARK_BLUE),
        cell('', 6480, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Areas Needing Improvement', 2880, PALE_ORANGE, true, ORANGE),
        cell('', 6480, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Re-Training Topics Required', 2880, PALE_RED, true, RED),
        cell('', 6480, WHITE),
      ]}),
      new TableRow({ children: [
        cell('Overall Recommendation', 2880, PALE_BLUE, true, DARK_BLUE),
        new TableCell({
          borders,
          width: { size: 6480, type: WidthType.DXA },
          shading: { fill: WHITE, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({ children: [run('  Pass — Ready for independent use', { size: 20 })], spacing: sp(40,40) }),
            new Paragraph({ children: [run('  Pass with Conditions — Re-training on specific modules', { size: 20 })], spacing: sp(40,40) }),
            new Paragraph({ children: [run('  Fail — Full KT session must be repeated', { size: 20 })], spacing: sp(40,40) }),
          ],
        }),
      ]}),
      new TableRow({ children: [
        cell('Next Review Date (if applicable)', 2880, PALE_BLUE, true, DARK_BLUE),
        cell('', 6480, WHITE),
      ]}),
    ],
  }),

  blankLine(), blankLine(),

  // Signature block
  new Paragraph({
    children: [bold('Signatures', { size: 26, color: DARK_BLUE })],
    shading: { fill: PALE_BLUE, type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: MID_BLUE, space: 6 } },
    indent: { left: 200 },
    spacing: sp(160, 80),
  }),

  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [3120, 3120, 3120],
    rows: [
      new TableRow({ children: [
        hdrCell('Candidate', 3120),
        hdrCell('Evaluator', 3120),
        hdrCell('Authorised By', 3120),
      ]}),
      new TableRow({ children: [
        cell([bold('Name: ', { size: 20, color: DARK_BLUE }), run('________________________', { size: 20 })], 3120, WHITE),
        cell([bold('Name: ', { size: 20, color: DARK_BLUE }), run('________________________', { size: 20 })], 3120, WHITE),
        cell([bold('Name: ', { size: 20, color: DARK_BLUE }), run('________________________', { size: 20 })], 3120, WHITE),
      ]}),
      new TableRow({ children: [
        cell([bold('Signature: ', { size: 20, color: DARK_BLUE }), run('___________________', { size: 20 })], 3120, GREY_BG),
        cell([bold('Signature: ', { size: 20, color: DARK_BLUE }), run('___________________', { size: 20 })], 3120, GREY_BG),
        cell([bold('Signature: ', { size: 20, color: DARK_BLUE }), run('___________________', { size: 20 })], 3120, GREY_BG),
      ]}),
      new TableRow({ children: [
        cell([bold('Date: ', { size: 20, color: DARK_BLUE }), run('___________________________', { size: 20 })], 3120, WHITE),
        cell([bold('Date: ', { size: 20, color: DARK_BLUE }), run('___________________________', { size: 20 })], 3120, WHITE),
        cell([bold('Score: ', { size: 20, color: DARK_BLUE }), run('_________ / 60', { size: 20 })], 3120, WHITE),
      ]}),
    ],
  }),

  blankLine(),
  p([run('MHS Marketing Dashboard — Client KT Evaluation  |  Version 1.0  |  June 2026  |  My Health School',
    { size: 18, color: '888888', italics: true })],
    { alignment: AlignmentType.CENTER }),
];

// ════════════════════════════════════════════════════════════════════════════
// BUILD DOCUMENT
// ════════════════════════════════════════════════════════════════════════════
const pageProps = {
  size: { width: 12240, height: 15840 },
  margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 },
};

const doc = new Document({
  numbering: {
    config: [
      { reference: 'ans-bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '-', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 600, hanging: 360 } } } }] },
      { reference: 'ans-numbers',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 600, hanging: 360 } } } }] },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: BLACK } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Calibri', color: WHITE },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Calibri', color: DARK_BLUE },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  sections: [
    // Cover (no header/footer)
    {
      properties: { page: pageProps },
      children: coverChildren,
    },
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
      headers: { default: makeHeader('Part B — Answer Key (Evaluator Only)') },
      footers: { default: makeFooter() },
      children: partBChildren,
    },
    // Part C
    {
      properties: { page: pageProps },
      headers: { default: makeHeader('Part C — Score Sheet & Evaluation Template') },
      footers: { default: makeFooter() },
      children: partCChildren,
    },
  ],
});

const outPath = path.join(__dirname, 'MHS_Dashboard_Client_Evaluation.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\nSUCCESS: ${outPath}`);
  console.log(`File size: ${kb} KB`);
}).catch(err => { console.error('ERROR:', err.message); process.exit(1); });
