import ExcelJS from 'exceljs';
import { GoogleGenAI } from '@google/genai';
import { formatMeetingTime } from '../utils/datetime.js';

/**
 * Daftar pembagian anggota tim per divisi untuk rapat harian B15M Seven Oceans.
 */
export const B15M_ROSTER = {
  SSS: [
    'W. Hariyadi', 'Sukanto', 'Edi Purwanto', 'John Rampala',
    'Eko Wicaksono', 'Prandi Marbun (On Board)', 'Basyarudin (On Board)',
    'Okvin Abrianto', 'Anisah', 'Shanti', 'Yulianto'
  ],
  SOSM: [
    'Andina Efviyanti', 'Herindra Setyo Prayogi', 'Ingga Cantika',
    'Lifiyah', 'Halya Gifara Kurniawan', 'Tiara S'
  ],
  SOPAL: [
    'Artikan Ndruru', 'Hafid Aldiansyah', 'Davauzi'
  ],
  PBS: [
    'Yang Mulyono'
  ],
  SOTS: [
    'Rangga Septian N', 'F. Hanindya Fernandito', 'Firman Eka Setiawan',
    'Stephanus Darell R', 'Hanwyn Tang', 'Rafi Rabbani'
  ],
  Corporate: [
    'Atandho', 'Joko', 'Dian Dwi', 'Ainur Rofik',
    'Maria Clarissa', 'Sherly Astuti', 'Kyesa Djibrilia', 'Kristina'
  ]
};

/**
 * Master data referensi armada: Pembagian PIC & Backup Operasional Kapal.
 */
export const B15M_SHIP_REFERENCE = [
  { no: 1, name: 'MT. Alpha Marine', pic: 'Pak Haryadi', backup: 'Pak Sukanto', status: 'Berlabuh / Persiapan Masuk', route: 'Pontianak', priority: 'Medium', division: 'Operation & Crewing' },
  { no: 2, name: 'Selat Sari', pic: 'Pak Haryadi', backup: 'Pak Sukanto', status: 'Selesai Bunker, Menuju Pelabuhan', route: 'Mabah, Buli', priority: 'Medium', division: 'Operation & Technical' },
  { no: 3, name: 'Semeru Mulia', pic: 'Pak Sukanto', backup: 'Capt. Timbul', status: 'Antri Sandar Bongkar', route: 'STS Moaramo', priority: 'Medium', division: 'Operation & Crewing' },
  { no: 4, name: 'Sea Safe 008', pic: 'Pak Marbun', backup: 'Capt. Edi', status: 'Sailing Menuju Pelabuhan', route: 'Dumai', priority: 'Medium', division: 'Operation & Crewing' },
  { no: 5, name: 'Huanya Star 001', pic: 'Pak Marbun', backup: 'Capt. Edi', status: 'Antri Bongkar Muatan', route: 'Merauke', priority: 'Medium', division: 'Operation & SOPAL' },
  { no: 6, name: 'Hua Navigator 1', pic: 'Capt. Timbul', backup: 'Pak Sukanto', status: 'Tiba STS / Persiapan Loading', route: 'Sungai Selais', priority: 'Medium', division: 'Operation & Crewing' },
  { no: 7, name: 'Hua Navigator 2', pic: 'Capt. Timbul', backup: 'Pak Sukanto', status: 'Bunker & Perbaikan Towing Line', route: 'Balikpapan (BPN)', priority: 'Urgent', division: 'Operation & Technical' },
  { no: 8, name: 'Wandao 1', pic: 'Pak Sukanto', backup: 'Capt. Timbul', status: 'Sailing (Isu Kemudi & Handover)', route: 'Kalteng Damparan', priority: 'Urgent', division: 'Operation & Technical' },
  { no: 9, name: 'Wandao 2', pic: 'Capt. Edi', backup: 'Pak Marbun', status: 'Menunggu Bongkar & Pengiriman Part', route: 'Laha, Seram', priority: 'Medium', division: 'Operation & Crewing' },
  { no: 10, name: 'Wandao 6', pic: 'Capt. Edi', backup: 'Pak John Mario', status: 'Anchor Rede / Overhaul ME', route: 'Tanjung Priok, Jakarta', priority: 'Medium', division: 'Operation & Technical' },
  { no: 11, name: 'TB Syukur 14', pic: 'Capt. Edi', backup: 'Pak John Mario', status: 'Standby Assist Operation', route: 'Jetty PLTU Pelabuhan Ratu', priority: 'Medium', division: 'Operation & Crewing' }
];

/**
 * Memeriksa apakah suatu meeting tergolong B15M (Fleet & Operations Sync pukul 08:00 WIB).
 */
export function isB15MMeeting(meeting, topic = '', startTime = null) {
  const combined = `${meeting?.topic || ''} ${topic || ''}`.toLowerCase();
  if (/b15m|b 15 m|b-15m|b 15m/i.test(combined)) {
    return true;
  }

  // Cek jam pelaksanaan: jika pukul 08:00 WIB (antara 07:40 - 08:45 WIB)
  const dtStr = startTime || meeting?.startTime;
  if (dtStr) {
    const dt = new Date(dtStr);
    if (!isNaN(dt.getTime())) {
      const wibHour = (dt.getUTCHours() + 7) % 24;
      const wibMin = dt.getUTCMinutes();
      const isAround08 = (wibHour === 8) || (wibHour === 7 && wibMin >= 40);
      if (isAround08 && /sync|briefing|fleet|armada|operasional|operasi|pagi|rapat/i.test(combined)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Format tanggal dalam bahasa Indonesia untuk B15M (contoh: "Selasa, 10 November 2026").
 */
export function formatB15MDate(dateObj = new Date()) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  
  // Convert ke WIB
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  const wibDate = new Date(utc + (3600000 * 7));

  const dayName = days[wibDate.getDay()];
  const day = wibDate.getDate();
  const monthName = months[wibDate.getMonth()];
  const year = wibDate.getFullYear();

  return `${dayName}, ${day} ${monthName} ${year}`;
}

/**
 * Format nama sheet (contoh: "10 Nov").
 */
export function formatB15MSheetName(dateObj = new Date()) {
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  const wibDate = new Date(utc + (3600000 * 7));
  return `${wibDate.getDate()} ${shortMonths[wibDate.getMonth()]}`;
}

/**
 * Memetakan peserta Zoom aktual ke dalam daftar absensi per divisi.
 */
export function mapB15MAttendance(actualParticipants = []) {
  const attendance = {};
  const actualNames = actualParticipants.map(p => (p.name || '').toLowerCase());

  for (const [division, members] of Object.entries(B15M_ROSTER)) {
    if (actualNames.length === 0) {
      attendance[division] = members.join(', ');
    } else {
      // Tandai yang hadir vs yang rostered
      const list = members.map(m => {
        const cleanM = m.replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
        const firstM = cleanM.split(' ')[0];
        const isPresent = actualNames.some(a => a.includes(cleanM) || (firstM.length > 2 && a.includes(firstM)));
        return isPresent ? `${m} (Hadir)` : m;
      });
      attendance[division] = list.join(', ');
    }
  }

  return attendance;
}

/**
 * Menggunakan Gemini AI untuk mengekstrak dan mengkategorikan poin-poin tindak lanjut B15M
 * ke dalam departemen, status, prioritas, target, kapal/proyek, PIC, dan progres.
 */
export async function extractB15MActionItems({ topic, summaryOverview, summaryDetails, nextSteps, transcript }) {
  const contextText = [
    topic ? `Topik Rapat: ${topic}` : '',
    summaryOverview ? `Ringkasan Rapat:\n${summaryOverview}` : '',
    summaryDetails && summaryDetails.length > 0 ? `Detail Pembahasan:\n${summaryDetails.map(d => `${d.label ? `[${d.label}] ` : ''}${d.summary}`).join('\n')}` : '',
    nextSteps && nextSteps.length > 0 ? `Action Items Terdeteksi:\n${nextSteps.join('\n')}` : '',
    transcript ? `Transkripsi:\n${transcript.slice(0, 5000)}` : ''
  ].filter(Boolean).join('\n\n');

  if (!contextText.trim() || !process.env.GEMINI_API_KEY) {
    return getDefaultB15MActionItems();
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `Anda adalah Asisten Notulis Profesional & Notula Tracker B15M (Fleet & Operations Sync Seven Oceans).
Tugas Anda adalah membaca rangkuman rapat B15M berikut dan menyusun daftar Action Items / Tindak Lanjut terperinci dalam format JSON Array.

Kategori Departemen yang diakui:
1. "DEPARTEMEN OPERASI & LOGISTIK"
2. "DEPARTEMEN TEKNIKAL & PERAWATAN"
3. "DEPARTEMEN SOPAL & LEGAL"
4. "DEPARTEMEN CREWING & FINANCE"
5. "DEPARTEMEN SOTS"
6. "DEPARTEMEN PROCUREMENT"
7. "DEPARTEMEN PBS & CHARTERING"

Untuk setiap tindak lanjut yang dibahas, tentukan:
- "status": "On Progress" | "Open" | "Done" | "Pending"
- "prioritas": "Urgent" | "HIGH" | "Medium" | "Low"
- "target_deadline": "URGENT" | "MONITOR" | "IN PROGRESS" | "HARI INI" | "BESOK PAGI" | "SEBELUM ONBOARD" atau tanggal
- "kapal_proyek": Nama kapal (misal: "DP 17 (Jaya Perkasa 17)", "Wandao 2", "TB PSL Carol", "Sea Safe 008", "Tongkang Manjiletung") atau nama proyek/isu
- "isu_rangkuman": Uraian jelas pembahasan masalah & instruksi tindak lanjut
- "pic": Nama PIC dan divisi (misal: "Agung (Operasional)", "Capt. Edi (Operasional)", "Eko Wicaksono (Technical)", "Okvin Abrianto (Technical)", "Herindra (Crewing)", "W. Hariyadi", "Artikan (SOPAL)", "Team Purchasing")
- "progres": Nilai desimal progres antara 0.0 sampai 1.0 (misal 0.0, 0.25, 0.5, 0.75, 1.0)
- "departemen": Salah satu nama departemen di atas (tanpa kata "DEPARTEMEN", misal: "Operasi & Logistik", "Technical", "SOPAL", "Crewing", "Finance", "SOTS", "Procurement")
- "dept_group": Nama kelompok header ("DEPARTEMEN OPERASI & LOGISTIK", "DEPARTEMEN TEKNIKAL & PERAWATAN", "DEPARTEMEN SOPAL & LEGAL", "DEPARTEMEN CREWING & FINANCE", dll.)

Konteks Rapat B15M:
${contextText}

Balas HANYA dengan JSON array valid:
[
  {
    "status": "On Progress",
    "prioritas": "HIGH",
    "target_deadline": "URGENT",
    "kapal_proyek": "DP 17 (Jaya Perkasa 17)",
    "isu_rangkuman": "Mencari peluang kargo aktif sehubungan kapal saat ini standby.",
    "pic": "Capt. Edi (Operasional)",
    "progres": 0.0,
    "departemen": "Operasi & Logistik",
    "dept_group": "DEPARTEMEN OPERASI & LOGISTIK"
  }
]`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsed = JSON.parse(response.text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.warn('Gagal mengekstrak B15M action items via AI, menggunakan fallback template:', err.message);
  }

  return getDefaultB15MActionItems();
}

/**
 * Fallback action items B15M berdasarkan isu operasional armada Seven Oceans.
 */
export function getDefaultB15MActionItems() {
  return [
    {
      status: 'On Progress',
      prioritas: 'Urgent',
      target_deadline: 'MONITOR',
      kapal_proyek: 'Tongkang / Proyek Manjiletung',
      isu_rangkuman: 'Pemeriksaan dermaga di Manjiletung untuk memastikan kesiapan akomodasi pemuatan sisi panjang kargo ban bekas.',
      pic: 'Agung (Operasional)',
      progres: 0.0,
      departemen: 'Operasi & Logistik',
      dept_group: 'DEPARTEMEN OPERASI & LOGISTIK'
    },
    {
      status: 'On Progress',
      prioritas: 'Medium',
      target_deadline: 'IN PROGRESS',
      kapal_proyek: 'Dermaga Manjiletung',
      isu_rangkuman: 'Mencari referensi dan data historis/informasi teknis pemuatan di Manjiletung guna mencegah kendala operasional.',
      pic: 'Agung (Operasional)',
      progres: 0.25,
      departemen: 'Operasi & Logistik',
      dept_group: 'DEPARTEMEN OPERASI & LOGISTIK'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'URGENT',
      kapal_proyek: 'DP 17 (Jaya Perkasa 17)',
      isu_rangkuman: 'Mencari peluang kargo untuk armada DP 17 sehubungan saat ini belum ada nominasi kargo aktif.',
      pic: 'Capt. Edi (Operasional)',
      progres: 0.0,
      departemen: 'Operasi & Logistik',
      dept_group: 'DEPARTEMEN OPERASI & LOGISTIK'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'BESOK PAGI',
      kapal_proyek: 'Armada Makassar',
      isu_rangkuman: 'Pengaturan jadwal survei vendor dan survei tahunan BKI untuk kapal yang dijadwalkan tiba di Makassar besok pagi.',
      pic: 'Capt. Edi & Tim Operasional',
      progres: 0.5,
      departemen: 'Operasi & Logistik',
      dept_group: 'DEPARTEMEN OPERASI & LOGISTIK'
    },
    {
      status: 'On Progress',
      prioritas: 'Medium',
      target_deadline: 'IN PROGRESS',
      kapal_proyek: 'Armada Sewa Makassar',
      isu_rangkuman: 'Meminta persetujuan (approval) manajemen/prinsipal untuk kapal sewa di area Makassar.',
      pic: 'W. Hariyadi',
      progres: 0.25,
      departemen: 'Operasi & Logistik',
      dept_group: 'DEPARTEMEN OPERASI & LOGISTIK'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'MONITOR',
      kapal_proyek: 'Wandao 2 (Wondero Two)',
      isu_rangkuman: 'Tindak lanjut perbaikan kendala mesin (engine issue) pada kapal Wandao 2 dan koordinasi suku cadang.',
      pic: 'Capt. Edi & Tim Teknis',
      progres: 0.0,
      departemen: 'Technical',
      dept_group: 'DEPARTEMEN TEKNIKAL & PERAWATAN'
    },
    {
      status: 'On Progress',
      prioritas: 'Urgent',
      target_deadline: 'URGENT',
      kapal_proyek: 'TB PSL Carol',
      isu_rangkuman: 'Pemantauan ketat konsumsi bahan bakar (BBM) dan memastikan pengajuan amprahan bunker dikelola sebelum kondisi darurat.',
      pic: 'Eko Wicaksono (Technical)',
      progres: 0.25,
      departemen: 'Technical',
      dept_group: 'DEPARTEMEN TEKNIKAL & PERAWATAN'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'HARI INI',
      kapal_proyek: 'Suku Cadang & Pompa',
      isu_rangkuman: 'Follow up via telepon ke vendor/pioneer terkait konfirmasi penawaran harga pengadaan pompa dan suku cadang kapal.',
      pic: 'Okvin Abrianto (Technical)',
      progres: 0.0,
      departemen: 'Technical',
      dept_group: 'DEPARTEMEN TEKNIKAL & PERAWATAN'
    },
    {
      status: 'On Progress',
      prioritas: 'Urgent',
      target_deadline: 'URGENT',
      kapal_proyek: 'TB Syukur 14',
      isu_rangkuman: 'Tindak lanjut pengadaan mendesak tali towing/tali tambat armada TB Syukur 14 untuk keselamatan kapal.',
      pic: 'Capt. Edi & Tim Teknis',
      progres: 0.0,
      departemen: 'Technical',
      dept_group: 'DEPARTEMEN TEKNIKAL & PERAWATAN'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'IN PROGRESS',
      kapal_proyek: 'Dokumen CLC / WRC',
      isu_rangkuman: 'Membantu pembaruan prosedur status shutdown dan kepatuhan regulasi sertifikat CLC / WRC.',
      pic: 'Capt. Edi & Artikan',
      progres: 0.25,
      departemen: 'SOPAL',
      dept_group: 'DEPARTEMEN SOPAL & LEGAL'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'URGENT',
      kapal_proyek: 'LS 8 (Sea Safe 008)',
      isu_rangkuman: 'Tindak lanjut penerbitan sertifikat asuransi kapal untuk LS 8, mencakup sertifikat CLC dan WRC.',
      pic: 'Capt. Edi (Operasi & SOPAL)',
      progres: 0.0,
      departemen: 'SOPAL',
      dept_group: 'DEPARTEMEN SOPAL & LEGAL'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'HARI INI / BESOK',
      kapal_proyek: 'JP 17 (Jaya Perkasa 17)',
      isu_rangkuman: 'Pemberian konfirmasi update kandidat Second Officer (Mualim II) untuk penempatan armada JP 17.',
      pic: 'Herindra (Crewing)',
      progres: 0.25,
      departemen: 'Crewing',
      dept_group: 'DEPARTEMEN CREWING & FINANCE'
    },
    {
      status: 'On Progress',
      prioritas: 'Urgent',
      target_deadline: 'SEBELUM ONBOARD',
      kapal_proyek: 'DP 17 (Jaya Perkasa 17)',
      isu_rangkuman: 'Pemanggilan seluruh kru terpilih DP 17 ke kantor untuk induksi operasional dan pelatihan PMS online.',
      pic: 'Capt. Edi & Crewing',
      progres: 0.25,
      departemen: 'Crewing',
      dept_group: 'DEPARTEMEN CREWING & FINANCE'
    },
    {
      status: 'On Progress',
      prioritas: 'HIGH',
      target_deadline: 'IN PROGRESS',
      kapal_proyek: 'Premi MA & Asuransi Kapal',
      isu_rangkuman: 'Tindak lanjut pembayaran premi Marine Asuransi serta koordinasi pengajuan invoice bersama Departemen Finance.',
      pic: 'Capt. Edi & Finance',
      progres: 0.25,
      departemen: 'Finance',
      dept_group: 'DEPARTEMEN CREWING & FINANCE'
    }
  ];
}

/**
 * Menghasilkan file Excel (.xlsx) Notula Rapat & Pelacak Tindak Lanjut B15M
 * dengan format, styling, warna, dan struktur yang identik dengan B15M.xlsx.
 */
export async function generateB15MExcelBuffer({
  meetingDate = new Date(),
  timeRange = '08:00 - 08:30 WIB',
  facilitator = 'Wajdi Hariyadi',
  meetingTitle = 'B15M - Fleet & Operations Sync (Koordinasi Armada & Tindak Lanjut)',
  actionItems = [],
  actualParticipants = []
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Seven Oceans - BOT AI ZOOM';
  wb.created = new Date();

  const sheetName = formatB15MSheetName(meetingDate);
  const ws = wb.addWorksheet(sheetName, {
    views: [{ showGridLines: true }]
  });

  // Lebar Kolom
  ws.columns = [
    { key: 'colA', width: 4 },
    { key: 'colB', width: 15 },
    { key: 'colC', width: 14 },
    { key: 'colD', width: 17 },
    { key: 'colE', width: 24 },
    { key: 'colF', width: 60 },
    { key: 'colG', width: 24 },
    { key: 'colH', width: 12 },
    { key: 'colI', width: 18 }
  ];

  const navyDark = 'FF1B365D';
  const navyMedium = 'FF2A4A7B';
  const lightBg = 'FFF6F8FB';
  const cardBg = 'FFEFF4F9';
  const headerCardBg = 'FFDCE4F1';

  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFD3D9E2' } },
    left: { style: 'thin', color: { argb: 'FFD3D9E2' } },
    bottom: { style: 'thin', color: { argb: 'FFD3D9E2' } },
    right: { style: 'thin', color: { argb: 'FFD3D9E2' } }
  };

  // Helper untuk styling cell
  const setCellStyle = (cellRef, { val, sz = 10, bold = false, color = 'FF000000', fill = null, hAlign = 'center', vAlign = 'middle', wrap = false, numFmt = null }) => {
    const c = ws.getCell(cellRef);
    if (val !== undefined && val !== null) c.value = val;
    c.font = { name: 'Calibri', size: sz, bold, color: { argb: color } };
    if (fill) {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }
    c.alignment = { horizontal: hAlign, vertical: vAlign, wrapText: wrap };
    c.border = thinBorder;
    if (numFmt) c.numFmt = numFmt;
    return c;
  };

  // Row 2: Main Header B2:I2
  ws.mergeCells('B2:I2');
  setCellStyle('B2', {
    val: 'NOTULA RAPAT & PELACAK TINDAK LANJUT B15M',
    sz: 13,
    bold: true,
    color: 'FFFFFFFF',
    fill: navyDark,
    hAlign: 'center',
    vAlign: 'middle'
  });
  ws.getRow(2).height = 28;

  // Row 3: Metadata 1
  ws.getRow(3).height = 22;
  setCellStyle('B3', { val: 'Hari & Tanggal', bold: true, color: navyDark, fill: lightBg, hAlign: 'left' });
  ws.mergeCells('C3:D3');
  setCellStyle('C3', { val: formatB15MDate(meetingDate), fill: lightBg, hAlign: 'left' });
  setCellStyle('D3', { fill: lightBg });
  setCellStyle('E3', { val: 'Waktu', bold: true, color: navyDark, fill: lightBg, hAlign: 'left' });
  ws.mergeCells('F3:G3');
  setCellStyle('F3', { val: timeRange, fill: lightBg, hAlign: 'left' });
  setCellStyle('G3', { fill: lightBg });
  setCellStyle('H3', { val: 'Lokasi', bold: true, color: navyDark, fill: lightBg, hAlign: 'left' });
  setCellStyle('I3', { val: 'Online Zoom Meeting', fill: lightBg, hAlign: 'left' });

  // Row 4: Metadata 2
  ws.getRow(4).height = 22;
  setCellStyle('B4', { val: 'Fasilitator', bold: true, color: navyDark, fill: lightBg, hAlign: 'left' });
  ws.mergeCells('C4:D4');
  setCellStyle('C4', { val: facilitator, fill: lightBg, hAlign: 'left' });
  setCellStyle('D4', { fill: lightBg });
  setCellStyle('E4', { val: 'Meeting Title', bold: true, color: navyDark, fill: lightBg, hAlign: 'left' });
  ws.mergeCells('F4:G4');
  setCellStyle('F4', { val: meetingTitle, fill: lightBg, hAlign: 'left' });
  setCellStyle('G4', { fill: lightBg });
  setCellStyle('H4', { val: 'Sifat Rapat', bold: true, color: navyDark, fill: lightBg, hAlign: 'left' });
  setCellStyle('I4', { val: 'Internal Operasional', fill: lightBg, hAlign: 'left' });

  // Row 5: Section Daftar Hadir
  ws.getRow(5).height = 22;
  ws.mergeCells('B5:I5');
  setCellStyle('B5', { val: 'Daftar Hadir & Absensi Tim', sz: 10, bold: true, color: navyDark, fill: headerCardBg, hAlign: 'left' });

  // Rows 6-11: Divisi Absensi
  const attendance = mapB15MAttendance(actualParticipants);
  const divRows = [
    { row: 6, code: 'SSS' },
    { row: 7, code: 'SOSM' },
    { row: 8, code: 'SOPAL' },
    { row: 9, code: 'PBS' },
    { row: 10, code: 'SOTS' },
    { row: 11, code: 'Corporate' }
  ];

  for (const item of divRows) {
    ws.getRow(item.row).height = 24;
    setCellStyle(`B${item.row}`, { val: item.code, sz: 9, bold: true, color: navyDark, fill: 'FFF9FBFC', hAlign: 'left' });
    ws.mergeCells(`C${item.row}:I${item.row}`);
    setCellStyle(`C${item.row}`, {
      val: attendance[item.code] || '',
      sz: 9,
      color: 'FF333333',
      fill: 'FFF9FBFC',
      hAlign: 'left',
      wrap: true
    });
  }

  // Row 13-16: Summary KPI Cards
  const totalItems = actionItems.length;
  const urgentCount = actionItems.filter(i => /urgent|high/i.test(i.prioritas || '')).length;
  const doneCount = actionItems.filter(i => i.progres >= 1.0 || /done|selesai|100%/i.test(i.status || '')).length;
  const uniqueDepts = new Set(actionItems.map(i => i.departemen || i.dept_group)).size || 5;

  const kpiCards = [
    { colStart: 'B', colEnd: 'C', title: 'TOTAL TINDAK LANJUT', val: totalItems, sub: 'Seluruh Seksi & Armada' },
    { colStart: 'D', colEnd: 'E', title: 'PRIORITAS TINGGI / URGENT', val: urgentCount, sub: 'Perlu Eskalasi Khusus' },
    { colStart: 'F', colEnd: 'G', title: 'ITEM SELESAI (100%)', val: doneCount, sub: 'Telah Direalisasikan' },
    { colStart: 'H', colEnd: 'I', title: 'DEPARTEMEN TERLIBAT', val: uniqueDepts, sub: 'Divisi Terkait Operasional' }
  ];

  ws.getRow(13).height = 20;
  ws.getRow(14).height = 28;
  ws.getRow(15).height = 6;
  ws.getRow(16).height = 18;

  for (const card of kpiCards) {
    ws.mergeCells(`${card.colStart}13:${card.colEnd}13`);
    setCellStyle(`${card.colStart}13`, { val: card.title, sz: 9, bold: true, color: 'FF4B5B92', fill: cardBg, hAlign: 'center' });

    ws.mergeCells(`${card.colStart}14:${card.colEnd}14`);
    setCellStyle(`${card.colStart}14`, { val: card.val, sz: 18, bold: true, color: navyDark, fill: cardBg, hAlign: 'center' });

    ws.mergeCells(`${card.colStart}15:${card.colEnd}15`);
    setCellStyle(`${card.colStart}15`, { val: '', fill: cardBg, hAlign: 'center' });

    ws.mergeCells(`${card.colStart}16:${card.colEnd}16`);
    setCellStyle(`${card.colStart}16`, { val: card.sub, sz: 8, color: 'FF546677', fill: cardBg, hAlign: 'center' });
  }

  // Row 18: Table Column Headers
  ws.getRow(18).height = 26;
  const headers = [
    { col: 'B', text: 'Status' },
    { col: 'C', text: 'Prioritas' },
    { col: 'D', text: 'Target / Deadline' },
    { col: 'E', text: 'Kapal / Proyek' },
    { col: 'F', text: 'Isu & Rangkuman Pembahasan Rapat' },
    { col: 'G', text: 'PIC / Tim Bertanggung Jawab' },
    { col: 'H', text: 'Progres' },
    { col: 'I', text: 'Departemen' }
  ];

  for (const h of headers) {
    setCellStyle(`${h.col}18`, { val: h.text, sz: 10, bold: true, color: 'FFFFFFFF', fill: navyDark, hAlign: 'center' });
  }

  // Kelompokkan item berdasarkan departemen
  const deptGroups = {};
  for (const item of actionItems) {
    const groupName = item.dept_group || `DEPARTEMEN ${String(item.departemen || 'OPERASIONAL').toUpperCase()}`;
    if (!deptGroups[groupName]) deptGroups[groupName] = [];
    deptGroups[groupName].push(item);
  }

  let currentRow = 19;
  for (const [groupTitle, items] of Object.entries(deptGroups)) {
    // Header Departemen
    ws.getRow(currentRow).height = 22;
    ws.mergeCells(`B${currentRow}:I${currentRow}`);
    setCellStyle(`B${currentRow}`, {
      val: `${groupTitle} (${items.length} ITEMS)`,
      sz: 10,
      bold: true,
      color: 'FFFFFFFF',
      fill: navyMedium,
      hAlign: 'center'
    });
    currentRow++;

    // Baris-baris Data
    for (const item of items) {
      ws.getRow(currentRow).height = 42;
      const isUrgent = /urgent/i.test(item.prioritas || '');
      const isHigh = /high/i.test(item.prioritas || '');
      const prioFill = isUrgent || isHigh ? 'FFFFF0F1' : 'FFFFFAEB';
      const prioColor = isUrgent || isHigh ? 'FFD32F2F' : 'FF8D6E10';

      setCellStyle(`B${currentRow}`, { val: item.status || 'On Progress', sz: 9, hAlign: 'center', vAlign: 'middle' });
      setCellStyle(`C${currentRow}`, { val: item.prioritas || 'Medium', sz: 9, bold: true, fill: prioFill, color: prioColor, hAlign: 'center', vAlign: 'middle' });
      setCellStyle(`D${currentRow}`, { val: item.target_deadline || 'MONITOR', sz: 9, hAlign: 'center', vAlign: 'middle' });
      setCellStyle(`E${currentRow}`, { val: item.kapal_proyek || '-', sz: 9, bold: true, hAlign: 'center', vAlign: 'middle', wrap: true });
      setCellStyle(`F${currentRow}`, { val: item.isu_rangkuman || '', sz: 9, hAlign: 'left', vAlign: 'middle', wrap: true });
      setCellStyle(`G${currentRow}`, { val: item.pic || '-', sz: 9, hAlign: 'center', vAlign: 'middle', wrap: true });
      
      const progVal = typeof item.progres === 'number' ? item.progres : parseFloat(item.progres) || 0.0;
      setCellStyle(`H${currentRow}`, { val: progVal, sz: 9, hAlign: 'center', vAlign: 'middle', numFmt: '0%' });
      setCellStyle(`I${currentRow}`, { val: item.departemen || '', sz: 9, hAlign: 'center', vAlign: 'middle' });

      currentRow++;
    }

    // Spacer row
    ws.getRow(currentRow).height = 10;
    currentRow++;
  }

  // Tabel Referensi Pembagian PIC & Backup Operasional Kapal
  currentRow += 1;
  ws.getRow(currentRow).height = 24;
  ws.mergeCells(`B${currentRow}:I${currentRow}`);
  setCellStyle(`B${currentRow}`, {
    val: 'TABEL REFERENSI: PEMBAGIAN PIC & BACKUP OPERASIONAL KAPAL',
    sz: 11,
    bold: true,
    color: 'FFFFFFFF',
    fill: navyDark,
    hAlign: 'center'
  });
  currentRow++;

  // Subheader Tabel Referensi
  ws.getRow(currentRow).height = 22;
  const refHeaders = [
    { col: 'B', text: 'No' },
    { col: 'C', text: 'Nama Kapal / Armada' },
    { col: 'D', text: 'PIC Utama' },
    { col: 'E', text: 'Backup PIC' },
    { col: 'F', text: 'Status Terkini' },
    { col: 'G', text: 'Lokasi / Rute Terakhir' },
    { col: 'H', text: 'Prioritas Monitoring' },
    { col: 'I', text: 'Divisi Terkait' }
  ];
  for (const rh of refHeaders) {
    setCellStyle(`${rh.col}${currentRow}`, { val: rh.text, sz: 10, bold: true, color: 'FFFFFFFF', fill: navyMedium, hAlign: 'center' });
  }
  currentRow++;

  // Baris-baris Armada
  for (const ship of B15M_SHIP_REFERENCE) {
    ws.getRow(currentRow).height = 22;
    const isUrg = /urgent/i.test(ship.priority);
    const fillRow = currentRow % 2 === 0 ? 'FFF9FBFC' : 'FFFFFFFF';

    setCellStyle(`B${currentRow}`, { val: ship.no, sz: 9, fill: fillRow, hAlign: 'center' });
    setCellStyle(`C${currentRow}`, { val: ship.name, sz: 9, bold: true, fill: fillRow, hAlign: 'left' });
    setCellStyle(`D${currentRow}`, { val: ship.pic, sz: 9, fill: fillRow, hAlign: 'center' });
    setCellStyle(`E${currentRow}`, { val: ship.backup, sz: 9, fill: fillRow, hAlign: 'center' });
    setCellStyle(`F${currentRow}`, { val: ship.status, sz: 9, fill: fillRow, hAlign: 'left' });
    setCellStyle(`G${currentRow}`, { val: ship.route, sz: 9, fill: fillRow, hAlign: 'left' });
    setCellStyle(`H${currentRow}`, {
      val: ship.priority,
      sz: 9,
      bold: true,
      color: isUrg ? 'FFD32F2F' : 'FF1B365D',
      fill: isUrg ? 'FFFFF0F1' : fillRow,
      hAlign: 'center'
    });
    setCellStyle(`I${currentRow}`, { val: ship.division, sz: 9, fill: fillRow, hAlign: 'center' });

    currentRow++;
  }

  return await wb.xlsx.writeBuffer();
}

/**
 * Menghasilkan konten CSV UTF-8 BOM untuk pelaporan B15M.
 */
export function generateB15MCSV({
  meetingDate = new Date(),
  timeRange = '08:00 - 08:30 WIB',
  facilitator = 'Wajdi Hariyadi',
  meetingTitle = 'B15M - Fleet & Operations Sync (Koordinasi Armada & Tindak Lanjut)',
  actionItems = [],
  actualParticipants = []
}) {
  const attendance = mapB15MAttendance(actualParticipants);
  const totalItems = actionItems.length;
  const urgentCount = actionItems.filter(i => /urgent|high/i.test(i.prioritas || '')).length;
  const doneCount = actionItems.filter(i => i.progres >= 1.0 || /done|selesai|100%/i.test(i.status || '')).length;
  const uniqueDepts = new Set(actionItems.map(i => i.departemen || i.dept_group)).size || 5;

  const escapeCSV = (val) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = [
    ['', 'NOTULA RAPAT & PELACAK TINDAK LANJUT B15M', '', '', '', '', '', '', ''],
    ['', 'Hari & Tanggal', escapeCSV(formatB15MDate(meetingDate)), '', 'Waktu', escapeCSV(timeRange), '', 'Lokasi', 'Online Zoom Meeting'],
    ['', 'Fasilitator', escapeCSV(facilitator), '', 'Meeting Title', escapeCSV(meetingTitle), '', 'Sifat Rapat', 'Internal Operasional'],
    ['', 'Daftar Hadir & Absensi Tim', '', '', '', '', '', '', ''],
    ['', 'SSS', escapeCSV(attendance.SSS || ''), '', '', '', '', '', ''],
    ['', 'SOSM', escapeCSV(attendance.SOSM || ''), '', '', '', '', '', ''],
    ['', 'SOPAL', escapeCSV(attendance.SOPAL || ''), '', '', '', '', '', ''],
    ['', 'PBS', escapeCSV(attendance.PBS || ''), '', '', '', '', '', ''],
    ['', 'SOTS', escapeCSV(attendance.SOTS || ''), '', '', '', '', '', ''],
    ['', 'Corporate', escapeCSV(attendance.Corporate || ''), '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['', 'TOTAL TINDAK LANJUT', '', 'PRIORITAS TINGGI / URGENT', '', 'ITEM SELESAI (100%)', '', 'DEPARTEMEN TERLIBAT', ''],
    ['', String(totalItems), '', String(urgentCount), '', String(doneCount), '', String(uniqueDepts), ''],
    ['', 'Seluruh Seksi & Armada', '', 'Perlu Eskalasi Khusus', '', 'Telah Direalisasikan', '', 'Divisi Terkait Operasional', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['', 'Status', 'Prioritas', 'Target / Deadline', 'Kapal / Proyek', 'Isu & Rangkuman Pembahasan Rapat', 'PIC / Tim Bertanggung Jawab', 'Progres', 'Departemen']
  ];

  // Action Items grouped
  const deptGroups = {};
  for (const item of actionItems) {
    const groupName = item.dept_group || `DEPARTEMEN ${String(item.departemen || 'OPERASIONAL').toUpperCase()}`;
    if (!deptGroups[groupName]) deptGroups[groupName] = [];
    deptGroups[groupName].push(item);
  }

  for (const [groupTitle, items] of Object.entries(deptGroups)) {
    rows.push(['', `${groupTitle} (${items.length} ITEMS)`, '', '', '', '', '', '', '']);
    for (const item of items) {
      const progStr = typeof item.progres === 'number' ? `${Math.round(item.progres * 100)}%` : `${item.progres || 0}%`;
      rows.push([
        '',
        escapeCSV(item.status || 'On Progress'),
        escapeCSV(item.prioritas || 'Medium'),
        escapeCSV(item.target_deadline || 'MONITOR'),
        escapeCSV(item.kapal_proyek || '-'),
        escapeCSV(item.isu_rangkuman || ''),
        escapeCSV(item.pic || '-'),
        escapeCSV(progStr),
        escapeCSV(item.departemen || '')
      ]);
    }
  }

  // Reference Table
  rows.push(['', '', '', '', '', '', '', '', '']);
  rows.push(['', 'TABEL REFERENSI: PEMBAGIAN PIC & BACKUP OPERASIONAL KAPAL', '', '', '', '', '', '', '']);
  rows.push(['', 'No', 'Nama Kapal / Armada', 'PIC Utama', 'Backup PIC', 'Status Terkini', 'Lokasi / Rute Terakhir', 'Prioritas Monitoring', 'Divisi Terkait']);
  for (const s of B15M_SHIP_REFERENCE) {
    rows.push([
      '',
      String(s.no),
      escapeCSV(s.name),
      escapeCSV(s.pic),
      escapeCSV(s.backup),
      escapeCSV(s.status),
      escapeCSV(s.route),
      escapeCSV(s.priority),
      escapeCSV(s.division)
    ]);
  }

  return '\uFEFF' + rows.map(r => r.join(',')).join('\r\n');
}

/**
 * Menyusun pesan WhatsApp resmi untuk Notula Rapat & Pelacak B15M.
 */
export function formatB15MWhatsAppMessage({
  meetingDate = new Date(),
  timeRange = '08:00 - 08:30 WIB',
  durationText = '25 Menit',
  facilitator = 'Wajdi Hariyadi',
  meetingTitle = 'B15M - Fleet & Operations Sync (Koordinasi Armada & Tindak Lanjut)',
  actionItems = [],
  actualParticipants = []
}) {
  const attendance = mapB15MAttendance(actualParticipants);
  const totalItems = actionItems.length;
  const urgentCount = actionItems.filter(i => /urgent|high/i.test(i.prioritas || '')).length;
  const doneCount = actionItems.filter(i => i.progres >= 1.0 || /done|selesai|100%/i.test(i.status || '')).length;
  const uniqueDepts = new Set(actionItems.map(i => i.departemen || i.dept_group)).size || 5;

  const lines = [
    `📋 *NOTULA RAPAT & PELACAK TINDAK LANJUT B15M*`,
    `🚢 *Fleet & Operations Sync (Seven Oceans)*`,
    ``,
    `📅 *Hari & Tanggal:* ${formatB15MDate(meetingDate)}`,
    `⏱️ *Waktu Pelaksanaan:* ${timeRange} (${durationText})`,
    `📍 *Lokasi:* Online Zoom Meeting`,
    `👤 *Fasilitator:* ${facilitator}`,
    `📌 *Topik:* ${meetingTitle}`,
    `🔒 *Sifat Rapat:* Internal Operasional`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `👥 *ABSENSI & KEHADIRAN TIM:*`,
    `• *SSS:* ${attendance.SSS || '-'}`,
    `• *SOSM:* ${attendance.SOSM || '-'}`,
    `• *SOPAL:* ${attendance.SOPAL || '-'}`,
    `• *PBS:* ${attendance.PBS || '-'}`,
    `• *SOTS:* ${attendance.SOTS || '-'}`,
    `• *Corporate:* ${attendance.Corporate || '-'}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `📊 *RINGKASAN METRIK PELACAK TINDAK LANJUT:*`,
    `• 📌 *Total Tindak Lanjut:* ${totalItems} Items`,
    `• 🚨 *Prioritas Tinggi / Urgent:* ${urgentCount} Items`,
    `• ✅ *Item Selesai (100%):* ${doneCount} Items`,
    `• 🏢 *Departemen Terlibat:* ${uniqueDepts} Divisi Operasional`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *HIGHLIGHT TINDAK LANJUT UTAMA:*`
  ];

  // Ambil top 2-3 items per departemen
  const deptGroups = {};
  for (const item of actionItems) {
    const groupName = item.dept_group || `DEPARTEMEN ${String(item.departemen || 'OPERASIONAL').toUpperCase()}`;
    if (!deptGroups[groupName]) deptGroups[groupName] = [];
    deptGroups[groupName].push(item);
  }

  for (const [groupTitle, items] of Object.entries(deptGroups)) {
    lines.push(``);
    lines.push(`🏢 *${groupTitle}*`);
    items.slice(0, 3).forEach((item, idx) => {
      const tag = item.prioritas ? `[${item.prioritas.toUpperCase()}] ` : '';
      const kapal = item.kapal_proyek ? `*${item.kapal_proyek}* - ` : '';
      lines.push(`${idx + 1}. ${tag}${kapal}${item.isu_rangkuman} _(PIC: ${item.pic})_`);
    });
    if (items.length > 3) {
      lines.push(`   _...dan ${items.length - 3} item tindak lanjut lainnya dalam tabel Excel._`);
    }
  }

  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📎 _File Excel resmi Notula Rapat & Pelacak Tindak Lanjut B15M terlampir otomatis di bawah._`);

  return lines.join('\n');
}

