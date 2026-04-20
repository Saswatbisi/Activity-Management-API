/**
 * PDF Ticket Generation Worker Thread
 *
 * This runs in a separate thread to avoid blocking the main event loop.
 * Uses PDFKit to generate a professional-looking event ticket.
 */

const { parentPort, workerData } = require('worker_threads');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Extract ticket data from the main thread
const {
  ticketId,
  activityTitle,
  activityDate,
  activityLocation,
  userName,
  userEmail,
  registeredAt,
} = workerData;

// Ensure tickets directory exists
const ticketsDir = path.join(__dirname, '..', 'tickets');
if (!fs.existsSync(ticketsDir)) {
  fs.mkdirSync(ticketsDir, { recursive: true });
}

const filePath = path.join(ticketsDir, `ticket-${ticketId}.pdf`);

try {
  // ── Create PDF Document ──────────────────────────────────
  const doc = new PDFDocument({
    size: 'A5',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });

  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  // ── Colors & Styling ────────────────────────────────────
  const primaryColor = '#1a1a2e';
  const accentColor = '#e94560';
  const lightColor = '#f5f5f5';
  const textColor = '#333333';

  // ── Background ──────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(lightColor);

  // ── Header Banner ───────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 80).fill(primaryColor);

  doc
    .fontSize(28)
    .font('Helvetica-Bold')
    .fillColor('#ffffff')
    .text('🎟️  EVENT TICKET', 40, 25, {
      width: doc.page.width - 80,
      align: 'center',
    });

  // ── Accent Strip ────────────────────────────────────────
  doc.rect(0, 80, doc.page.width, 5).fill(accentColor);

  // ── Activity Title ──────────────────────────────────────
  doc
    .fontSize(22)
    .font('Helvetica-Bold')
    .fillColor(primaryColor)
    .text(activityTitle || 'Activity', 40, 110, {
      width: doc.page.width - 80,
      align: 'center',
    });

  // ── Divider ─────────────────────────────────────────────
  doc
    .moveTo(60, 150)
    .lineTo(doc.page.width - 60, 150)
    .strokeColor(accentColor)
    .lineWidth(2)
    .stroke();

  // ── Ticket Details (Left Column) ────────────────────────
  const leftX = 60;
  const rightX = doc.page.width / 2 + 20;
  let currentY = 170;

  // Left Column: Event Details
  doc.fontSize(10).font('Helvetica-Bold').fillColor(accentColor);
  doc.text('EVENT DETAILS', leftX, currentY);

  currentY += 20;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(textColor);
  doc.text('📅 Date:', leftX, currentY);
  doc
    .font('Helvetica')
    .text(
      activityDate
        ? new Date(activityDate).toLocaleDateString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'TBD',
      leftX + 55,
      currentY
    );

  currentY += 22;
  doc.font('Helvetica-Bold').text('📍 Location:', leftX, currentY);
  doc
    .font('Helvetica')
    .text(activityLocation || 'TBD', leftX + 75, currentY);

  currentY += 22;
  doc.font('Helvetica-Bold').text('🕐 Registered:', leftX, currentY);
  doc
    .font('Helvetica')
    .text(
      registeredAt
        ? new Date(registeredAt).toLocaleString('en-IN')
        : 'N/A',
      leftX + 85,
      currentY
    );

  // Right Column: Attendee Details
  currentY = 170;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(accentColor);
  doc.text('ATTENDEE DETAILS', rightX, currentY);

  currentY += 20;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(textColor);
  doc.text('👤 Name:', rightX, currentY);
  doc.font('Helvetica').text(userName || 'N/A', rightX + 55, currentY);

  currentY += 22;
  doc.font('Helvetica-Bold').text('📧 Email:', rightX, currentY);
  doc.font('Helvetica').text(userEmail || 'N/A', rightX + 55, currentY);

  currentY += 22;
  doc.font('Helvetica-Bold').text('🎫 Ticket ID:', rightX, currentY);
  doc.font('Helvetica').fontSize(9).text(ticketId || 'N/A', rightX + 75, currentY);

  // ── Bottom Divider ──────────────────────────────────────
  doc
    .moveTo(60, 280)
    .lineTo(doc.page.width - 60, 280)
    .strokeColor('#cccccc')
    .lineWidth(1)
    .dash(5, { space: 5 })
    .stroke();

  // ── Footer ──────────────────────────────────────────────
  doc
    .undash()
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#888888')
    .text(
      'This ticket was generated automatically. Please present this ticket at the event venue.',
      40,
      295,
      {
        width: doc.page.width - 80,
        align: 'center',
      }
    );

  doc
    .fontSize(8)
    .fillColor(accentColor)
    .text('Powered by Activity Management API — MeetMux Capstone', 40, 315, {
      width: doc.page.width - 80,
      align: 'center',
    });

  // ── Finalize ────────────────────────────────────────────
  doc.end();

  writeStream.on('finish', () => {
    parentPort.postMessage({ success: true, filePath, ticketId });
  });

  writeStream.on('error', (err) => {
    parentPort.postMessage({ success: false, error: err.message });
  });
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message });
}
