/**
 * Service integrasi pengiriman pesan via WhatsApp Cloud API (Meta Graph API).
 */

/**
 * Mengirim pesan teks ke pengguna WhatsApp.
 * 
 * @param {string} to - Nomor tujuan WhatsApp (format internasional tanpa tanda +, contoh: 6281234567890)
 * @param {string} messageText - Teks pesan balasan
 * @returns {Promise<Object>}
 */
export async function sendWhatsAppMessage(to, messageText) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!token || !phoneNumberId) {
    throw new Error('Konfigurasi WhatsApp Cloud API (WHATSAPP_TOKEN atau WHATSAPP_PHONE_NUMBER_ID) belum diatur di environment variables');
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: true,
      body: messageText
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Gagal mengirim WhatsApp ke ${to}:`, errorBody);
    throw new Error(`WhatsApp API Error (${response.status}): ${errorBody}`);
  }

  return await response.json();
}

/**
 * Menandai pesan masuk sebagai telah dibaca (centang biru) agar pengguna tahu pesan sedang diproses.
 * 
 * @param {string} messageId - ID pesan WhatsApp masuk
 * @returns {Promise<boolean>}
 */
export async function markWhatsAppAsRead(messageId) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!token || !phoneNumberId || !messageId) return false;

  try {
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      })
    });
    return true;
  } catch (err) {
    console.warn('Gagal menandai pesan WhatsApp as read:', err.message);
    return false;
  }
}
