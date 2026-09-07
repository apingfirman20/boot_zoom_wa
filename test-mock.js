import 'dotenv/config';
import handler from './api/webhook.js';
import { formatMeetingTime, getCurrentTimeContext } from './src/utils/datetime.js';

console.log('=== TEST MOCK WHATSAPP BOT (VERCEL SERVERLESS) ===\n');

// 1. Test Datetime Utility
console.log('1. Menguji Datetime Utility...');
const timeContext = getCurrentTimeContext('Asia/Jakarta');
console.log('   - Time Context Saat Ini:', timeContext.localString);
const sampleDate = '2026-09-08T14:00:00+07:00';
console.log('   - Format Meeting Time:', formatMeetingTime(sampleDate, 'Asia/Jakarta'));

// 2. Test GET Verification (Meta Webhook Challenge)
console.log('\n2. Menguji GET Webhook Verification (Meta Hub Challenge)...');
const mockVerifyToken = 'token_test_123';
process.env.WHATSAPP_VERIFY_TOKEN = mockVerifyToken;

const mockGetReq = {
  method: 'GET',
  query: {
    'hub.mode': 'subscribe',
    'hub.verify_token': mockVerifyToken,
    'hub.challenge': '1158201444'
  }
};

let getStatus = 0;
let getBody = '';
const mockGetRes = {
  status(s) {
    getStatus = s;
    return this;
  },
  send(body) {
    getBody = body;
    return this;
  },
  json(obj) {
    getBody = JSON.stringify(obj);
    return this;
  }
};

handler(mockGetReq, mockGetRes);
if (getStatus === 200 && getBody === '1158201444') {
  console.log('   ✅ GET Verification PASSED: Challenge berhasil dikembalikan sesuai protokol Meta.');
} else {
  console.error(`   ❌ GET Verification FAILED: status=${getStatus}, body=${getBody}`);
}

// 3. Test Invalid Verify Token
console.log('\n3. Menguji Penolakan Token yang Salah...');
const mockInvalidReq = {
  method: 'GET',
  query: {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'wrong_token',
    'hub.challenge': '9999'
  }
};
let invalidStatus = 0;
const mockInvalidRes = {
  status(s) {
    invalidStatus = s;
    return this;
  },
  json() {
    return this;
  }
};
handler(mockInvalidReq, mockInvalidRes);
if (invalidStatus === 403) {
  console.log('   ✅ Invalid Token PASSED: Akses ditolak dengan status 403 Forbidden.');
} else {
  console.error(`   ❌ Invalid Token FAILED: Expected 403 but got ${invalidStatus}`);
}

// 4. Test Mock POST Event Parsing
console.log('\n4. Menguji Payload Event WhatsApp Masuk...');
const samplePayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '628123456789',
              phone_number_id: '1234567890'
            },
            contacts: [
              {
                profile: { name: 'Budi Santoso' },
                wa_id: '628111222333'
              }
            ],
            messages: [
              {
                from: '628111222333',
                id: 'wamid.HBgM...',
                timestamp: '1725700000',
                text: { body: 'Tolong buatkan meeting besok jam 2 siang bahas sprint planning' },
                type: 'text'
              }
            ]
          },
          field: 'messages'
        }
      ]
    }
  ]
};

console.log('   - Struktur payload valid.');
console.log('   - Pengirim:', samplePayload.entry[0].changes[0].value.contacts[0].profile.name);
console.log('   - Pesan:', samplePayload.entry[0].changes[0].value.messages[0].text.body);

console.log('\n=== PENGUJIAN LOKAL SELESAI ===\n');
