import assert from 'assert';
import {
  parseEndMeetingCommand,
  parseMeetingCommand,
  parseHelpCommand
} from './src/utils/parser.js';
import {
  endZoomMeeting,
  getLiveZoomMeetings
} from './src/services/zoom.js';

console.log('🧪 Memulai Pengujian Fitur "end boy"...');

// Test 1: parseEndMeetingCommand dengan berbagai format variasi
const t1 = parseEndMeetingCommand('end boy');
assert(t1 && t1.isEndMeetingCommand, 'Test 1 gagal: end boy harus terdeteksi');
console.log('✅ Test 1: "end boy" terdeteksi');

const t2 = parseEndMeetingCommand('End Boy');
assert(t2 && t2.isEndMeetingCommand, 'Test 2 gagal: End Boy (kapital) harus terdeteksi');
console.log('✅ Test 2: "End Boy" (kapital) terdeteksi');

const t3 = parseEndMeetingCommand('end boy dong');
assert(t3 && t3.isEndMeetingCommand, 'Test 3 gagal: "end boy dong" harus terdeteksi');
console.log('✅ Test 3: "end boy dong" terdeteksi');

const t4 = parseEndMeetingCommand('tolong end boy ya');
assert(t4 && t4.isEndMeetingCommand, 'Test 4 gagal: "tolong end boy ya" harus terdeteksi');
console.log('✅ Test 4: "tolong end boy ya" terdeteksi');

const t5 = parseEndMeetingCommand('!end boy');
assert(t5 && t5.isEndMeetingCommand, 'Test 5 gagal: "!end boy" harus terdeteksi');
console.log('✅ Test 5: "!end boy" terdeteksi');

const t6 = parseEndMeetingCommand('end boy 82242480038');
assert(t6 && t6.isEndMeetingCommand && t6.meetingId === '82242480038', 'Test 6 gagal: meeting ID harus ter-ekstrak');
console.log('✅ Test 6: "end boy 82242480038" terdeteksi dengan Meeting ID:', t6.meetingId);

const t7 = parseEndMeetingCommand('stop meeting');
assert(t7 && t7.isEndMeetingCommand, 'Test 7 gagal: "stop meeting" harus terdeteksi');
console.log('✅ Test 7: "stop meeting" terdeteksi');

const t8 = parseEndMeetingCommand('akhiri zoom');
assert(t8 && t8.isEndMeetingCommand, 'Test 8 gagal: "akhiri zoom" harus terdeteksi');
console.log('✅ Test 8: "akhiri zoom" terdeteksi');

// Test 9: Pastikan tidak bentrok dengan parser pembuatan meeting
const t9 = parseMeetingCommand('end boy');
assert(t9 === null, 'Test 9 gagal: "end boy" tidak boleh dianggap membuat meeting');
console.log('✅ Test 9: "end boy" tidak memicu pembuatan meeting');

// Test 10: Pastikan tidak memicu help pesan sapaan
const t10 = parseHelpCommand('end boy', { isPrivateChat: true });
assert(t10 === null, 'Test 10 gagal: "end boy" tidak boleh dianggap sapaan bantuan');
console.log('✅ Test 10: "end boy" tidak memicu pesan help / greeting');

// Test 11: Pastikan fungsi export zoom tersedia
assert(typeof endZoomMeeting === 'function', 'endZoomMeeting harus berupa function');
assert(typeof getLiveZoomMeetings === 'function', 'getLiveZoomMeetings harus berupa function');
console.log('✅ Test 11: endZoomMeeting dan getLiveZoomMeetings terdefinisi sebagai function');

console.log('\n🧪 Memulai Pengujian Fitur Google Meet (GMeet)...');

// Test 12: Permintaan pembuatan Google Meet TIM SOTS
const t12 = parseMeetingCommand('buatkan google meet jam 10 untuk TIM SOTS');
assert(t12 && t12.isMeetingCommand, 'Test 12 gagal: harus terdeteksi sebagai meeting command');
assert(t12.platform === 'GMEET', 'Test 12 gagal: platform harus GMEET');
assert(t12.topic.toLowerCase().includes('sots'), 'Test 12 gagal: topik harus mengandung sots');
assert(t12.autoRecord === true, 'Test 12 gagal: autoRecord harus true');
assert(t12.autoSummary === true, 'Test 12 gagal: autoSummary harus true');
console.log('✅ Test 12: "buatkan google meet jam 10 untuk TIM SOTS" -> Platform GMEET, AutoRecord: true, AutoSummary: true');

// Test 13: Permintaan gmeet singkat
const t13 = parseMeetingCommand('gmeet besok jam 2 siang topik evaluasi');
assert(t13 && t13.platform === 'GMEET', 'Test 13 gagal: gmeet harus terdeteksi');
console.log('✅ Test 13: "gmeet besok jam 2 siang" -> Platform GMEET');

// Test 14: Permintaan zoom tetap platform ZOOM
const t14 = parseMeetingCommand('buatkan zoom jam 3 sore tim finance');
assert(t14 && t14.platform === 'ZOOM', 'Test 14 gagal: zoom harus terdeteksi sebagai ZOOM');
console.log('✅ Test 14: "buatkan zoom jam 3 sore" -> Platform ZOOM');

console.log('\n🎉 Semua pengujian (Zoom + Google Meet) BERHASIL 100%!\n');
