import React, { useState } from "react";
import "./Collaboration.css";

const SECTIONS = [
  { id: "architecture", label: "System Architecture", icon: "🏗️" },
  { id: "qr-module", label: "QR Code Generation", icon: "📱" },
  { id: "whatsapp", label: "WhatsApp Bot", icon: "💬" },
  { id: "webinar", label: "Webinar Integration", icon: "🎥" },
  { id: "analytics", label: "Analytics Dashboard", icon: "📊" },
  { id: "testing", label: "Testing & QA", icon: "✅" },
  { id: "deployment", label: "Deployment", icon: "🚀" },
  { id: "monitoring", label: "Monitoring & Alerts", icon: "🔔" },
  { id: "api-ref", label: "API Reference", icon: "📡" },
  { id: "troubleshooting", label: "Troubleshooting", icon: "🔧" },
];

function CollapsibleSection({ title, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collab-section ${open ? "open" : ""}`}>
      <button className="collab-section-header" onClick={() => setOpen(!open)}>
        <div className="section-header-left">
          <span className="section-icon">{icon}</span>
          <span className="section-title">{title}</span>
        </div>
        <span className={`section-chevron ${open ? "rotated" : ""}`}>▼</span>
      </button>
      {open && <div className="collab-section-body">{children}</div>}
    </div>
  );
}

function CodeBlock({ title, children }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="code-block-wrapper">
      {title && <div className="code-block-title">{title}</div>}
      <div className="code-block">
        <button className="code-copy-btn" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
        <pre><code>{children}</code></pre>
      </div>
    </div>
  );
}

function DataTable({ headers, rows }) {
  return (
    <div className="collab-table-wrap">
      <table className="collab-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ type, children }) {
  return <span className={`collab-badge badge-${type}`}>{children}</span>;
}

export default function Collaboration() {
  const [activeNav, setActiveNav] = useState("architecture");

  const scrollTo = (id) => {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="collaboration-page">
      {/* Header */}
      <div className="collab-hero">
        <div className="collab-hero-content">
          <h1 className="collab-hero-title">
            <span className="hero-icon">🤝</span>
            MHS Hypeloop Campaign
          </h1>

        </div>
      </div>

      <div className="collab-layout">
        {/* Sticky side navigation */}
        <aside className="collab-sidebar-nav">
          <div className="collab-nav-label">GUIDE SECTIONS</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`collab-nav-item ${activeNav === s.id ? "active" : ""}`}
              onClick={() => scrollTo(s.id)}
            >
              <span className="nav-item-icon">{s.icon}</span>
              <span className="nav-item-label">{s.label}</span>
            </button>
          ))}
        </aside>

        {/* Main content */}
        <div className="collab-main">

          {/* 1. System Architecture */}
          <div id="architecture">
            <CollapsibleSection title="1. System Architecture Overview" icon="🏗️" defaultOpen>
              <h4 className="subsection-title">1.1 High-Level Component Map</h4>
              <p className="section-desc">
                The campaign tech stack has five primary layers that work together to move a resident from ad impression to L1 purchase:
              </p>
              <DataTable
                headers={["Layer", "Component", "Responsibility", "Owner"]}
                rows={[
                  ["L1 – Ad", "Hypeloop Screen", "Display creative, render QR per zone", "Marketing"],
                  ["L2 – Capture", "QR + UTM Redirect", "Zone-tagged deep-link → WhatsApp or Landing Page", "Engineering"],
                  ["L3 – Nurture", "WhatsApp Bot / Automation", "Welcome flow, webinar registration, reminders", "Engineering"],
                  ["L4 – Convert", "Tagmango + Zoom", "Webinar delivery, L1 payment checkout", "Marketing"],
                  ["L5 – Analytics", "Google Analytics / Sheets", "UTM attribution, funnel metrics, CAC dashboard", "Engineering"],
                ]}
              />

              <h4 className="subsection-title">1.2 Data Flow Diagram</h4>
              <div className="flow-diagram">
                <div className="flow-step flow-start">
                  <div className="flow-step-icon">📺</div>
                  <div className="flow-step-label">Hypeloop Screen</div>
                  <div className="flow-step-desc">Resident scans QR</div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="flow-step-icon">🔀</div>
                  <div className="flow-step-label">Redirect Server</div>
                  <div className="flow-step-desc">Logs zone, timestamp, IP</div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="flow-step-icon">💬</div>
                  <div className="flow-step-label">WhatsApp Bot</div>
                  <div className="flow-step-desc">Welcome flow triggered</div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="flow-step-icon">📝</div>
                  <div className="flow-step-label">Tagmango / Form</div>
                  <div className="flow-step-desc">Webinar registration</div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="flow-step-icon">🔔</div>
                  <div className="flow-step-label">Reminder Engine</div>
                  <div className="flow-step-desc">T-24h, T-2h reminders</div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="flow-step-icon">🎥</div>
                  <div className="flow-step-label">Zoom Webinar</div>
                  <div className="flow-step-desc">Live session</div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step flow-end">
                  <div className="flow-step-icon">💰</div>
                  <div className="flow-step-label">L1 Purchase</div>
                  <div className="flow-step-desc">Tagmango checkout</div>
                </div>
              </div>

              <h4 className="subsection-title">1.3 Tech Stack Summary</h4>
              <DataTable
                headers={["Concern", "Technology", "Notes"]}
                rows={[
                  ["QR Generation", "qrcode (npm) / Python qrcode", "One QR per zone; UTM-tagged WhatsApp URL as payload"],
                  ["Redirect / Short URL", "Node.js + Express or bit.ly", "Enables A/B destination swap without reprinting QR"],
                  ["WhatsApp Automation", "WhatsApp Business API (Meta)", "Official BSP recommended; handles templates & flows"],
                  ["Bot Logic", "Node.js (Express + axios)", "Webhook handler for incoming WhatsApp messages"],
                  ["Webinar Registration", "Tagmango native / Google Forms", "Tagmango preferred for unified payment + webinar"],
                  ["Webinar Delivery", "Zoom Webinar API", "Auto-add registrants; send Zoom join link via WhatsApp"],
                  ["Analytics", "Google Analytics 4 + Google Sheets", "UTM params flow into GA4; Sheets for daily CAC report"],
                  ["Data Store", "Google Sheets or PostgreSQL", "Lightweight: Sheets sufficient for 3-month pilot"],
                  ["Hosting", "Railway / Render / AWS Lambda", "Low-traffic; serverless Lambda is cost-effective"],
                ]}
              />
            </CollapsibleSection>
          </div>

          {/* 2. QR Code Generation */}
          <div id="qr-module">
            <CollapsibleSection title="3. QR Code Generation Module" icon="📱">
              <h4 className="subsection-title">3.1 Zone Configuration</h4>
              <p className="section-desc">
                Each zone requires a unique QR code whose payload encodes the UTM-tagged WhatsApp deep-link. The zone config is the single source of truth.
              </p>
              <CodeBlock title="qr-generator/zones.config.json">{`{
  "zones": [
    {
      "id": "ambattur",
      "label": "Ambattur",
      "utmSource": "hypeloop_ambattur",
      "utmCampaign": "diabetes_webinar_q1",
      "waNumber": "919XXXXXXXXX",
      "waText": "Webinar+Ambattur",
      "tier": 1
    },
    {
      "id": "valasaravakkam",
      "label": "Valasaravakkam",
      "utmSource": "hypeloop_valasaravakkam",
      "utmCampaign": "diabetes_webinar_q1",
      "waNumber": "919XXXXXXXXX",
      "waText": "Webinar+Valasa",
      "tier": 1
    }
    // ... repeat for all 9 zones
  ]
}`}</CodeBlock>

              <h4 className="subsection-title">3.2 QR Generator Script</h4>
              <CodeBlock title="qr-generator/generate.js">{`const QRCode  = require('qrcode');
const path    = require('path');
const fs      = require('fs');
const zones   = require('./zones.config.json').zones;

const BASE_REDIRECT = process.env.BASE_REDIRECT_URL;

async function generateQRForZone(zone) {
  // Option A: Direct WhatsApp deep-link
  const waURL = \`https://wa.me/\${zone.waNumber}?text=\${zone.waText}\`;

  // Option B (RECOMMENDED): Via redirect server
  const redirectURL = \`\${BASE_REDIRECT}/r/\${zone.id}\` +
    \`?utm_source=\${zone.utmSource}\` +
    \`&utm_medium=ooh_digital\` +
    \`&utm_campaign=\${zone.utmCampaign}\` +
    \`&utm_content=qr_scan\`;

  const outputPath = path.join(__dirname, 'output', \`qr_\${zone.id}.png\`);

  await QRCode.toFile(outputPath, redirectURL, {
    errorCorrectionLevel: 'H',  // Level H = 30% recovery
    type: 'png',
    width: 1200,                // High-res for screen use
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  console.log(\`[✓] Zone: \${zone.label} → \${outputPath}\`);
  return outputPath;
}

(async () => {
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  for (const zone of zones) {
    await generateQRForZone(zone);
  }
  console.log('\\n[✓] All QR codes generated successfully.');
})();`}</CodeBlock>

              <div className="alert-box alert-warning">
                <strong>⚠️ WARNING:</strong> Run <code>node generate.js</code> after any zone config change. Deliver QR PNG files to the creative team as 1200x1200px assets. The QR must occupy ≥25% of the final screen creative area.
              </div>

              <h4 className="subsection-title">3.3 QR Validation Checklist</h4>
              <ul className="check-list">
                <li>Scan QR from 3 feet away on an Android device (standard resident behaviour)</li>
                <li>Scan from 5 feet away – must still resolve without error</li>
                <li>Test on both iOS (Camera app) and Android (Google Lens + Camera)</li>
                <li>Verify redirect URL encodes correct UTM source for each zone</li>
                <li>Confirm WhatsApp opens pre-filled message (not blank chat)</li>
                <li>Verify error correction is Level H (check QRCode generation options)</li>
                <li>Test with screen glare simulation (angle phone at 45° to screen)</li>
              </ul>
            </CollapsibleSection>
          </div>

          {/* 4. WhatsApp Bot */}
          <div id="whatsapp">
            <CollapsibleSection title="4. WhatsApp Bot / Automation Engine" icon="💬">
              <p className="section-desc">
                The WhatsApp Bot is the core nurture engine. It handles incoming messages, triggers conversation flows, and manages the user journey from first contact to webinar registration.
              </p>
              <h4 className="subsection-title">Conversation Flows</h4>
              <div className="flow-cards">
                <div className="mini-card">
                  <div className="mini-card-icon">👋</div>
                  <h5>Welcome Flow</h5>
                  <p>Greets the user, captures zone from pre-filled text, sends intro video/message about the webinar.</p>
                  <code>flows/welcome.js</code>
                </div>
                <div className="mini-card">
                  <div className="mini-card-icon">📝</div>
                  <h5>Registration Flow</h5>
                  <p>Sends Tagmango registration link, confirms sign-up, stores lead in Google Sheets.</p>
                  <code>flows/registration.js</code>
                </div>
                <div className="mini-card">
                  <div className="mini-card-icon">🔔</div>
                  <h5>Reminder Flow</h5>
                  <p>T-24h and T-2h automated reminders with Zoom join link. Powered by node-schedule or SQS.</p>
                  <code>flows/reminder.js</code>
                </div>
                <div className="mini-card">
                  <div className="mini-card-icon">📞</div>
                  <h5>Follow-up Flow</h5>
                  <p>T+30min post-webinar message to non-buyers with checkout link and urgency nudge.</p>
                  <code>flows/followup.js</code>
                </div>
              </div>

              <h4 className="subsection-title">Bot Endpoints</h4>
              <DataTable
                headers={["Method", "Endpoint", "Description", "Auth"]}
                rows={[
                  [<Badge type="get">GET</Badge>, "/webhook", "Meta webhook verification", "hub.verify_token"],
                  [<Badge type="post">POST</Badge>, "/webhook", "Receive incoming WhatsApp messages", "Meta signed payload"],
                  [<Badge type="post">POST</Badge>, "/webhooks/tagmango", "Receive Tagmango registration/purchase events", "HMAC-SHA256"],
                  [<Badge type="get">GET</Badge>, "/health", "Service health check", "None"],
                ]}
              />
            </CollapsibleSection>
          </div>

          {/* 5. Webinar Integration */}
          <div id="webinar">
            <CollapsibleSection title="5. Webinar Integration (Tagmango + Zoom)" icon="🎥">
              <p className="section-desc">
                Tagmango handles registration and payment. Zoom delivers the webinar. The integration auto-adds registrants to Zoom and sends join links via WhatsApp.
              </p>
              <div className="integration-flow">
                <div className="int-step">
                  <span className="int-num">1</span>
                  <div>
                    <strong>User registers on Tagmango</strong>
                    <p>Via link sent by WhatsApp bot</p>
                  </div>
                </div>
                <div className="int-step">
                  <span className="int-num">2</span>
                  <div>
                    <strong>Tagmango fires webhook</strong>
                    <p>POST /webhooks/tagmango with registration data</p>
                  </div>
                </div>
                <div className="int-step">
                  <span className="int-num">3</span>
                  <div>
                    <strong>Bot adds registrant to Zoom</strong>
                    <p>Uses Zoom Webinar API to register user</p>
                  </div>
                </div>
                <div className="int-step">
                  <span className="int-num">4</span>
                  <div>
                    <strong>Zoom join link sent via WhatsApp</strong>
                    <p>Confirmation message with date, time, and link</p>
                  </div>
                </div>
                <div className="int-step">
                  <span className="int-num">5</span>
                  <div>
                    <strong>Reminders fired at T-24h & T-2h</strong>
                    <p>Automated WhatsApp template messages</p>
                  </div>
                </div>
                <div className="int-step">
                  <span className="int-num">6</span>
                  <div>
                    <strong>Post-webinar follow-up at T+30min</strong>
                    <p>Non-buyers receive checkout nudge</p>
                  </div>
                </div>
              </div>
            </CollapsibleSection>
          </div>

          {/* 6. Analytics */}
          <div id="analytics">
            <CollapsibleSection title="6. Analytics & Reporting" icon="📊">
              <h4 className="subsection-title">6.1 Google Sheets Schema</h4>
              <p className="section-desc">Columns tracked in the analytics sheet:</p>
              <div className="schema-tags">
                {["date", "zone_id", "zone_label", "tier", "total_scans", "registrations",
                  "attendees", "l1_customers", "CAC", "ROAS"].map((col) => (
                  <span key={col} className="schema-tag">{col}</span>
                ))}
              </div>
              <div className="alert-box alert-critical">
                <strong>🚫 CRITICAL:</strong> Store only hashed phone numbers (SHA-256) in the sheet for privacy. Never store raw phone numbers in analytics systems.
              </div>

              <h4 className="subsection-title">6.2 CAC & ROAS Calculation Script</h4>
              <CodeBlock title="analytics-dashboard/daily-report.js">{`// Run daily via cron: 0 8 * * * node daily-report.js
const { getSheetData, writeSheetRow } = require('./sheets-helper');

async function generateDailyReport() {
  const [scans, leads, purchases, budget] = await Promise.all([
    getSheetData('Scans'),
    getSheetData('Leads'),
    getSheetData('Purchases'),
    getSheetData('Budget'),
  ]);

  const today          = new Date().toISOString().split('T')[0];
  const totalSpend     = budget.reduce((s, r) => s + Number(r.total_spend), 0);
  const totalScans     = scans.length;
  const totalRegs      = leads.filter(l => l.stage === 'REGISTERED').length;
  const totalAttendees = leads.filter(l => l.stage === 'ATTENDED').length;
  const totalL1        = purchases.length;
  const l1Revenue      = totalL1 * 4000;  // ₹4,000/month
  const l1LTV6m        = totalL1 * 4000 * 6;

  const cac  = totalL1 > 0 ? Math.round(totalSpend / totalL1) : 0;
  const roas = totalSpend > 0 ? (l1Revenue / totalSpend).toFixed(2) : 0;
  const roasLTV = totalSpend > 0 ? (l1LTV6m / totalSpend).toFixed(2) : 0;

  await writeSheetRow('Dashboard', [
    today, totalScans, totalRegs, totalAttendees, totalL1,
    totalSpend, cac, roas, roasLTV,
  ]);

  console.log(\`[\${today}] Scans:\${totalScans} Regs:\${totalRegs} L1:\${totalL1} CAC:₹\${cac} ROAS:\${roas}x\`);
}

generateDailyReport().catch(console.error);`}</CodeBlock>

              <h4 className="subsection-title">6.3 GA4 Event Tracking</h4>
              <CodeBlock title="GA4 Measurement Protocol">{`async function sendGA4Event(clientId, eventName, params = {}) {
  await axios.post(
    \`https://www.google-analytics.com/mp/collect\` +
    \`?measurement_id=\${process.env.GA4_MEASUREMENT_ID}\` +
    \`&api_secret=\${process.env.GA4_API_SECRET}\`,
    {
      client_id: clientId,
      events: [{ name: eventName, params }],
    }
  );
}

// Fire these events at each funnel step:
// qr_scan          → zone, utm_source, utm_campaign
// wa_message_in    → zone
// webinar_registered → zone
// webinar_attended   → zone
// l1_purchased       → zone, revenue: 4000, currency: 'INR'`}</CodeBlock>
            </CollapsibleSection>
          </div>

          {/* 7. Testing & QA */}
          <div id="testing">
            <CollapsibleSection title="7. Testing & QA" icon="✅">
              <h4 className="subsection-title">7.1 Pre-Launch End-to-End Checklist</h4>
              <DataTable
                headers={["#", "Test", "Expected Result", "Owner"]}
                rows={[
                  ["1", "Scan QR for Ambattur zone on Android", "WhatsApp opens with pre-filled zone text", "Engineering"],
                  ["2", "Scan QR for Ambattur zone on iOS", "Same as above", "Engineering"],
                  ["3", "Send message to WhatsApp bot", "Welcome message received within 5 seconds", "Engineering"],
                  ["4", "Verify redirect server logs scan event to Sheets", "New row in Scans tab within 10 sec", "Engineering"],
                  ["5", "Complete Tagmango registration", "WhatsApp welcome + registration confirmation received", "Engineering"],
                  ["6", "Verify Zoom registration fires after Tagmango webhook", "Registrant appears in Zoom webinar dashboard", "Engineering"],
                  ["7", "Simulate T-24h reminder (fast-forward job)", "Template message received on test phone", "Engineering"],
                  ["8", "Simulate T-2h reminder", "Template message with Zoom link received", "Engineering"],
                  ["9", "Simulate T+30min post-webinar follow-up", "Follow-up template message received", "Engineering"],
                  ["10", "Complete L1 purchase (test mode)", "Lead stage updated to L1_PURCHASED in Sheets", "Engineering"],
                  ["11", "Run daily-report.js manually", "Dashboard tab updated with correct metrics", "Engineering"],
                  ["12", "Scan QR from all 3 Tier-1 zones", "Correct utm_source logged for each zone", "Marketing + Eng"],
                ]}
              />

              <h4 className="subsection-title">7.2 Load & Resilience Testing</h4>
              <ul className="check-list">
                <li>Simulate 100 concurrent QR scans (redirect server must respond &lt;200ms)</li>
                <li>Simulate 50 simultaneous WhatsApp incoming messages (bot must not drop any)</li>
                <li>Test Tagmango webhook retry handling (server should be idempotent on duplicate events)</li>
                <li>Test server restart: verify no in-flight Sheets writes are lost</li>
                <li>Test WhatsApp API rate limits: Meta allows 1,000 messages/sec on standard tier</li>
              </ul>
            </CollapsibleSection>
          </div>

          {/* 8. Deployment */}
          <div id="deployment">
            <CollapsibleSection title="8. Deployment & Infrastructure" icon="🚀">
              <h4 className="subsection-title">8.1 Recommended Deployment Architecture</h4>
              <DataTable
                headers={["Service", "Platform", "Notes"]}
                rows={[
                  ["Redirect Server", "AWS Lambda + API Gateway", "Serverless; auto-scales with QR scan bursts; near-zero idle cost"],
                  ["WhatsApp Bot", "Railway.app / Render", "Always-on required for webhook; 512MB RAM sufficient"],
                  ["Scheduler / Reminders", "Railway + node-schedule or AWS SQS", "SQS recommended for production (survives restarts)"],
                  ["Analytics Report", "GitHub Actions (daily cron)", "Free; runs daily-report.js on schedule"],
                  ["Domain", "r.myhealthschool.in", "Short domain for redirect URL; SSL required (Let's Encrypt)"],
                ]}
              />

              <h4 className="subsection-title">8.2 Docker Compose (Development)</h4>
              <CodeBlock title="docker-compose.yml">{`version: '3.8'

services:
  redirect:
    build: ./redirect-server
    ports: ['3000:3000']
    env_file: .env
    restart: always

  bot:
    build: ./whatsapp-bot
    ports: ['3001:3001']
    env_file: .env
    restart: always
    depends_on: [redirect]

  # Use ngrok or similar for local WhatsApp webhook testing
  # ngrok http 3001 → copy HTTPS URL to Meta webhook config`}</CodeBlock>

              <h4 className="subsection-title">8.3 SSL & Security Requirements</h4>
              <ul className="check-list">
                <li>HTTPS is mandatory – Meta WhatsApp webhook requires HTTPS with a valid SSL cert</li>
                <li>Rotate WA_ACCESS_TOKEN every 60 days or use a System User permanent token</li>
                <li>Validate Tagmango webhook signature on every request (HMAC-SHA256)</li>
                <li>Never log raw phone numbers – hash with SHA-256 before any persistence</li>
                <li>Set rate limiting on /webhook endpoint: max 500 req/min per IP</li>
                <li>Use environment-specific .env files: .env.dev, .env.staging, .env.prod</li>
              </ul>
            </CollapsibleSection>
          </div>

          {/* 9. Monitoring */}
          <div id="monitoring">
            <CollapsibleSection title="9. Monitoring, Alerts & Maintenance" icon="🔔">
              <h4 className="subsection-title">9.1 Health Checks</h4>
              <CodeBlock title="Uptime Monitoring">{`# Configure UptimeRobot (free) to ping every 5 min
GET https://r.myhealthschool.in/health     → expect {status:'ok'}
GET https://bot.myhealthschool.in/health   → expect {status:'ok'}

# Alert channels: SMS + WhatsApp to tech lead on any downtime`}</CodeBlock>

              <h4 className="subsection-title">9.2 Critical Alerts</h4>
              <DataTable
                headers={["Alert Condition", "Severity", "Action"]}
                rows={[
                  ["Redirect server down > 5 minutes", <Badge type="critical">CRITICAL</Badge>, "Page on-call; check Lambda/Railway logs immediately"],
                  ["WhatsApp bot not responding", <Badge type="critical">CRITICAL</Badge>, "Restart bot service; check WA token expiry"],
                  ["0 QR scans in 24h after Week 2", <Badge type="high">HIGH</Badge>, "Verify creative is live on screen; check redirect server logs"],
                  ["Tagmango webhook 4xx/5xx > 10/hr", <Badge type="high">HIGH</Badge>, "Check webhook signature logic; test Tagmango integration"],
                  ["Google Sheets write failures > 3/hr", <Badge type="medium">MEDIUM</Badge>, "Check service account credentials; verify Sheets quota"],
                  ["Daily CAC > ₹10,000 after Month 1", <Badge type="medium">MEDIUM</Badge>, "Escalate to marketing team for creative/zone review"],
                ]}
              />

              <h4 className="subsection-title">9.3 Weekly Maintenance Checklist</h4>
              <ul className="check-list">
                <li>Review Sheets Dashboard tab – verify scan, registration, and L1 numbers are incrementing</li>
                <li>Check WhatsApp Business API message status (any template rejected by Meta?)</li>
                <li>Verify redirect server is returning correct destinations for all active zones</li>
                <li>Review Zoom webinar registrant list – confirm all Tagmango registrants appear</li>
                <li>Rotate creatives: upload new QR-enabled creative to Hypeloop portal if swap is due</li>
                <li>Pull weekly Hypeloop property-level impression report and cross-reference with Scans tab</li>
              </ul>
            </CollapsibleSection>
          </div>

          {/* 10. API Reference */}
          <div id="api-ref">
            <CollapsibleSection title="10. Internal API Reference" icon="📡">
              <h4 className="subsection-title">10.1 Redirect Server Endpoints</h4>
              <DataTable
                headers={["Method", "Endpoint", "Description", "Response"]}
                rows={[
                  [<Badge type="get">GET</Badge>, "/r/:zoneId", "Redirect to WhatsApp or LP for given zone", "302 redirect + logs scan"],
                  [<Badge type="get">GET</Badge>, "/health", "Service health check", "200 {status:'ok'}"],
                  [<Badge type="get">GET</Badge>, "/zones", "List all zones and their redirect destinations", "200 [{id, label, dest}]"],
                ]}
              />

              <h4 className="subsection-title">10.2 WhatsApp Bot Endpoints</h4>
              <DataTable
                headers={["Method", "Endpoint", "Description", "Auth"]}
                rows={[
                  [<Badge type="get">GET</Badge>, "/webhook", "Meta webhook verification", "hub.verify_token"],
                  [<Badge type="post">POST</Badge>, "/webhook", "Receive incoming WhatsApp messages", "Meta signed payload"],
                  [<Badge type="post">POST</Badge>, "/webhooks/tagmango", "Receive Tagmango registration/purchase events", "HMAC-SHA256 signature"],
                  [<Badge type="get">GET</Badge>, "/health", "Service health check", "None"],
                ]}
              />
            </CollapsibleSection>
          </div>

          {/* 11. Troubleshooting */}
          <div id="troubleshooting">
            <CollapsibleSection title="11. Troubleshooting Guide" icon="🔧">
              <DataTable
                headers={["Symptom", "Diagnosis & Fix"]}
                rows={[
                  [
                    "QR scans are happening but no WhatsApp messages arriving",
                    "Check: (1) WA_ACCESS_TOKEN not expired; (2) WhatsApp number has messaging capability; (3) Webhook URL is correct in Meta dashboard; (4) SSL cert valid on webhook server"
                  ],
                  [
                    "WhatsApp messages arriving but Sheets not updating",
                    "Check: (1) GOOGLE_SERVICE_ACCOUNT_EMAIL has edit access to the Sheet; (2) GOOGLE_PRIVATE_KEY has no escaped newline issues; (3) Google Sheets API quota not exceeded"
                  ],
                  [
                    "Tagmango webhook not firing",
                    "Check: (1) Webhook URL configured in Tagmango dashboard; (2) Server is publicly accessible (not localhost); (3) TAGMANGO_WEBHOOK_SECRET matches exactly; (4) Review Tagmango webhook delivery logs"
                  ],
                  [
                    "Zoom registrant not appearing after Tagmango registration",
                    "Check: (1) ZOOM_WEBINAR_ID is correct; (2) Zoom OAuth token not expired; (3) Email format from Tagmango matches Zoom requirements; (4) Review addToZoomWebinar error logs"
                  ],
                  [
                    "Reminder messages not sending",
                    "Check: (1) node-schedule jobs not lost on restart (migrate to Redis/SQS); (2) WA template names match exactly; (3) Templates approved by Meta; (4) Phone number in E.164 format"
                  ],
                  [
                    "Wrong zone attribution in Sheets",
                    "Check: (1) QR payload encodes correct zone ID; (2) zones.config.json has no duplicate IDs; (3) Redirect server zone map built correctly at startup"
                  ],
                ]}
              />
            </CollapsibleSection>
          </div>

          {/* Footer */}
          <div className="collab-footer">
            <p>
              Document prepared for <strong>My Health School</strong> &middot; <strong>Doctor Farmer</strong> &middot; <strong>Dr. Prabhakar Raj</strong> &middot; 2026
            </p>
            <p className="footer-note">
              All code samples are reference implementations. Review and adapt for your production environment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
