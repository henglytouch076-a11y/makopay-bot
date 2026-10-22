require('dotenv').config();
const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { createKhqrCard } = require('./khqr_card');

// Guide & Welcome Videos Configuration
function resolveVideoPath(...names) {
  for (const name of names) {
    const exts = ['.mp4', '.MOV', '.mov', '.MP4'];
    for (const ext of exts) {
      const p = path.join(__dirname, `${name}${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// Persistent Media Cache (Zero Re-Uploads for Lightning Speed)
const MEDIA_CACHE_FILE = path.join(__dirname, 'media_cache.json');
let mediaCache = {};
try {
  if (fs.existsSync(MEDIA_CACHE_FILE)) {
    mediaCache = JSON.parse(fs.readFileSync(MEDIA_CACHE_FILE, 'utf-8'));
  }
} catch (_) {}

function saveMediaCache() {
  try {
    fs.writeFileSync(MEDIA_CACHE_FILE, JSON.stringify(mediaCache, null, 2), 'utf-8');
  } catch (_) {}
}

const WELCOME_VIDEO_PATH = resolveVideoPath('videwellcome', 'videwelcome', 'welcome', 'welcomevideo', 'IMG_0942') || path.join(__dirname, 'videwellcome.mp4');
let cachedWelcomeVideoFileId = process.env.WELCOME_VIDEO_FILE_ID || mediaCache.welcomeVideoFileId || 'BAACAgUAAyEGAATsD9-7AAMeato-Kjc2179z9mY6OoEhjpyG_JIAAhwiAAJY1dBWk2UsrBW_1cI9BA';

function getWelcomeVideo() {
  if (cachedWelcomeVideoFileId) return cachedWelcomeVideoFileId;
  const filePath = resolveVideoPath('videwellcome', 'videwelcome', 'welcome', 'welcomevideo', 'IMG_0942');
  if (filePath) return { source: filePath };
  if (fs.existsSync(WELCOME_VIDEO_PATH)) return { source: WELCOME_VIDEO_PATH };
  return null;
}

const LOGO_IMAGE_PATH = path.join(__dirname, 'image.png');
let cachedLogoPhotoFileId = process.env.LOGO_PHOTO_FILE_ID || mediaCache.logoPhotoFileId || null;

function getLogoPhoto() {
  if (cachedLogoPhotoFileId) return cachedLogoPhotoFileId;
  if (fs.existsSync(LOGO_IMAGE_PATH)) return { source: LOGO_IMAGE_PATH };
  return null;
}

let cachedAddFundsVideoFileId = process.env.ADDFUNDS_VIDEO_FILE_ID || mediaCache.addFundsVideoFileId || null;
function getAddFundsVideo() {
  if (cachedAddFundsVideoFileId) return cachedAddFundsVideoFileId;
  const filePath = resolveVideoPath('addfound', 'addfunds', 'topup');
  return filePath ? { source: filePath } : null;
}

let cachedWithdrawVideoFileId = process.env.WITHDRAW_VIDEO_FILE_ID || mediaCache.withdrawVideoFileId || null;
function getWithdrawVideo() {
  if (cachedWithdrawVideoFileId) return cachedWithdrawVideoFileId;
  const filePath = resolveVideoPath('withdrawmoney', 'withdraw', 'withdraw_money');
  return filePath ? { source: filePath } : null;
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || '-1002180018274';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@MakoVIPgroup';
const CHANNEL_LINK = process.env.CHANNEL_LINK || 'https://t.me/MakoVIPgroup';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || '@ma_ko168';
const SUPPORT_LINK = process.env.SUPPORT_LINK || 'https://t.me/ma_ko168';

// Admin Notification Groups (Only send to private groups, never to public channel)
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '-1003960463291';
const ADMIN_TOPUP_GROUP_ID = process.env.ADMIN_TOPUP_GROUP_ID || ADMIN_GROUP_ID;
const ADMIN_WITHDRAW_GROUP_ID = process.env.ADMIN_WITHDRAW_GROUP_ID || '-1003907785147';

// PayLinkAPI Configuration
const PAYLINK_BASE_URL = (process.env.PAYLINK_BASE_URL || 'https://paylinkapi-bot.onrender.com').replace(/\/+$/, '');
const PAYLINK_API_KEY = process.env.PAYLINK_API_KEY || 'plk_live_std_c3558761993b';
const PAYLINK_SECRET = process.env.PAYLINK_SECRET || 'whsec_afe9c40b20d3e9ec';
const BAKONG_ACCOUNT = process.env.BAKONG_ACCOUNT || 'hengly_touch@bkrt';
const STORE_NAME = process.env.STORE_NAME || 'MAKO CAMBO';
const MOBCASH_APP_URL = process.env.MOBCASH_APP_URL || 'https://tinyurl.com/mobcashnew';
const MOBCASH_CASHIER_KEY = process.env.MOBCASH_CASHIER_KEY || 'f5e141da52d922e26a661fe750744fef6a15c1777b3970ec36b3c78269409c29';
const MOBCASH_API_URL = process.env.MOBCASH_API_URL || '';
let activeMiniappUrl = process.env.MINIAPP_URL || mediaCache.activeMiniappUrl || ''; // Set dynamically by initHttpsTunnel()

// Auto-dispatch or record deposit to MobCash Cashier with API Key
async function dispatchMobcashDeposit({ oneXBetId, amount, tranId }) {
  console.log(`[MobCash Auto-Dispatch] Sending deposit to 1xBet ID ${oneXBetId}, Amount: $${amount}, Key: ${MOBCASH_CASHIER_KEY.slice(0, 8)}...`);
  if (!MOBCASH_API_URL) {
    console.log(`[MobCash Cashier Mode] Deposit recorded successfully for 1xBet ID ${oneXBetId} (Tran: ${tranId})`);
    return { success: true, mode: 'cashier_desk', key: MOBCASH_CASHIER_KEY, tranId };
  }
  try {
    const res = await fetch(MOBCASH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOBCASH_CASHIER_KEY}`,
        'x-api-key': MOBCASH_CASHIER_KEY
      },
      body: JSON.stringify({ oneXBetId, amount, tranId }),
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data };
  } catch (err) {
    console.warn('[MobCash Dispatch Warning]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Robust Multi-Pass QR Code Decoder from an Image Buffer
 * Handles raw images, mobile screenshots, orientation, and contrast variations
 */
async function decodeQrFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;

  try {
    const meta = await sharp(buffer).metadata().catch(() => ({}));
    let pipeline = sharp(buffer);
    if ((meta.width && meta.width > 1400) || (meta.height && meta.height > 1400)) {
      pipeline = pipeline.resize({ width: 1200, height: 1200, fit: 'inside' });
    }
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let code = null;
    try {
      code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    } catch (_) {}
    if (code && code.data && code.data.trim()) return code.data.trim();

    // Pass 2: Grayscale + normalized contrast
    const proc = await sharp(buffer)
      .resize({ width: 800, height: 800, fit: 'inside' })
      .grayscale()
      .normalize()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    try {
      code = jsQR(new Uint8ClampedArray(proc.data), proc.info.width, proc.info.height);
    } catch (_) {}
    if (code && code.data && code.data.trim()) return code.data.trim();

    // Pass 3: Invert colors
    const inverted = await sharp(buffer)
      .resize({ width: 800, height: 800, fit: 'inside' })
      .negate({ alpha: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    try {
      code = jsQR(new Uint8ClampedArray(inverted.data), inverted.info.width, inverted.info.height);
    } catch (_) {}
    if (code && code.data && code.data.trim()) return code.data.trim();

    return null;
  } catch (err) {
    console.warn('[QR Decode Warning]:', err.message);
    return null;
  }
}

/**
 * Parse Bakong KHQR / Cambodian Banking EMVCo QR Code Payload
 * Accurately extracts Bank Name, Account Holder Name, and Account ID
 */
function parseKhqrInfo(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  const str = rawStr.trim();

  const info = {
    raw: str,
    bankName: 'Bakong / ABA KHQR',
    accountName: '',
    accountId: '',
    currency: 'USD'
  };

  // 1. Accurate EMVCo TLV Parser for KHQR
  try {
    let i = 0;
    while (i + 4 <= str.length) {
      const tag = str.slice(i, i + 2);
      const len = parseInt(str.slice(i + 2, i + 4), 10);
      if (isNaN(len) || i + 4 + len > str.length) break;
      const val = str.slice(i + 4, i + 4 + len);

      // Tag 59: Merchant / Account Holder Name
      if (tag === '59') {
        info.accountName = val.trim();
      }

      // Tag 29 or Tag 30: Merchant Account Information
      if (tag === '29' || tag === '30') {
        let j = 0;
        while (j + 4 <= val.length) {
          const subTag = val.slice(j, j + 2);
          const subLen = parseInt(val.slice(j + 2, j + 4), 10);
          if (isNaN(subLen) || j + 4 + subLen > val.length) break;
          const subVal = val.slice(j + 4, j + 4 + subLen);
          if (subTag === '01') {
            info.accountId = subVal.trim();
          }
          j += 4 + subLen;
        }
      }
      i += 4 + len;
    }
  } catch (_) {}

  // Fallback regex for account name if TLV didn't capture Tag 59
  if (!info.accountName) {
    const mName = str.match(/59(\d{2})([A-Za-z0-9\s\.\-_&]{2,40})/);
    if (mName) {
      const len = parseInt(mName[1], 10);
      info.accountName = mName[2].slice(0, len).trim();
    }
  }

  // Fallback regex for account ID
  if (!info.accountId) {
    const mAcc1 = str.match(/(?:29|30)\d{2}.*?01(\d{2})([a-zA-Z0-9_\.\-]{3,40})/);
    if (mAcc1) {
      const len = parseInt(mAcc1[1], 10);
      info.accountId = mAcc1[2].slice(0, len).trim();
    } else {
      const mAcc2 = str.match(/([a-zA-Z0-9_\.\-]+@(abaa|aclb|wing|bkrt|cpbk|spbk|ftbb|prbk|hattha|vattanac|chipmong|prince|phillip|shinhan|ppcb))/i);
      if (mAcc2) info.accountId = mAcc2[1].trim();
    }
  }

  // Sanitize accountName (limit to 22 chars so it never wraps to 2 lines on mobile)
  if (info.accountName && info.accountName.length > 22) {
    info.accountName = info.accountName.slice(0, 22).trim();
  }

  // 3. Detect Cambodian Bank
  const lower = (str + ' ' + info.accountId).toLowerCase();
  if (lower.includes('@abaa') || lower.includes('aba bank') || lower.includes('payway') || lower.includes('aba')) {
    info.bankName = 'ABA Bank KHQR';
  } else if (lower.includes('@aclb') || lower.includes('acleda')) {
    info.bankName = 'ACLEDA Bank KHQR';
  } else if (lower.includes('@wing') || lower.includes('wing')) {
    info.bankName = 'Wing Bank KHQR';
  } else if (lower.includes('@cpbk') || lower.includes('canadia')) {
    info.bankName = 'Canadia Bank KHQR';
  } else if (lower.includes('@spbk') || lower.includes('sathapana')) {
    info.bankName = 'Sathapana Bank KHQR';
  } else if (lower.includes('@ftbb') || lower.includes('ftb')) {
    info.bankName = 'FTB Bank KHQR';
  } else if (lower.includes('@prbk') || lower.includes('prasac')) {
    info.bankName = 'KB PRASAC Bank KHQR';
  } else if (lower.includes('@hattha') || lower.includes('hattha')) {
    info.bankName = 'Hattha Bank KHQR';
  } else if (lower.includes('@vattanac') || lower.includes('vattanac')) {
    info.bankName = 'Vattanac Bank KHQR';
  } else if (lower.includes('@chipmong') || lower.includes('chip mong')) {
    info.bankName = 'Chip Mong Bank KHQR';
  } else if (lower.includes('@prince') || lower.includes('prince')) {
    info.bankName = 'Prince Bank KHQR';
  } else if (lower.includes('@phillip') || lower.includes('phillip')) {
    info.bankName = 'Phillip Bank KHQR';
  } else if (lower.includes('@shinhan') || lower.includes('shinhan')) {
    info.bankName = 'Shinhan Bank KHQR';
  } else if (lower.includes('@bkrt') || lower.includes('bakong')) {
    info.bankName = 'Bakong KHQR';
  } else {
    info.bankName = 'Bakong / ABA KHQR';
  }

  return info;
}

if (!BOT_TOKEN) {
  console.error("❌ ERROR: BOT_TOKEN is missing in .env file!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Global Error Handler to prevent any process crashes
bot.catch((err, ctx) => {
  console.warn(`[Telegraf Error] for ${ctx.updateType}:`, err.message);
});

// ---------------- TELEGRAM PREMIUM ANIMATED CUSTOM EMOJIS ----------------
const ANIM = {
  MEGAPHONE: '<tg-emoji emoji-id="5424818078833715060">📣</tg-emoji>',
  BULB: '<tg-emoji emoji-id="5422439311196834318">💡</tg-emoji>',
  FLOWER: '<tg-emoji emoji-id="5465119341815027379">🌸</tg-emoji>',
  CHECK: '<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji>',
  SUCCESS: '<tg-emoji emoji-id="5280786041324707830">✅</tg-emoji>',
  CROSS: '<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>',
  CROWN: '<tg-emoji emoji-id="5217822164362739968">👑</tg-emoji>',
  USER: '<tg-emoji emoji-id="5217822164362739968">👑</tg-emoji>',
  OFFICER: '<tg-emoji emoji-id="5280958226563606026">👮</tg-emoji>',
  DIAMOND: '<tg-emoji emoji-id="5427168083074628963">💎</tg-emoji>',
  STAR: '<tg-emoji emoji-id="5438496463044752972">⭐️</tg-emoji>',
  SPARKLES: '<tg-emoji emoji-id="5325547803936572038">✨</tg-emoji>',
  FIRE: '<tg-emoji emoji-id="5424972470023104089">🔥</tg-emoji>',
  LIGHTNING: '<tg-emoji emoji-id="5456140674028019486">⚡️</tg-emoji>',
  MONEY: '<tg-emoji emoji-id="5409048419211682843">💵</tg-emoji>',
  WAVE: '<tg-emoji emoji-id="5407076281898512830">👋</tg-emoji>',
  PARTY: '<tg-emoji emoji-id="5461151367559141950">🎉</tg-emoji>',
  WARN: '<tg-emoji emoji-id="5447644880824181073">⚠️</tg-emoji>',
  ID: '<tg-emoji emoji-id="5334544901428229844">ℹ️</tg-emoji>',
  INFO: '<tg-emoji emoji-id="5334544901428229844">ℹ️</tg-emoji>',
  CALENDAR: '<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji>',
  DOWN: '<tg-emoji emoji-id="5406745015365943482">⬇️</tg-emoji>',
  CHAT: '<tg-emoji emoji-id="5443038326535759644">💬</tg-emoji>',
  CART: '<tg-emoji emoji-id="5229064374403998351">🛍</tg-emoji>',
  CHART: '<tg-emoji emoji-id="5244837092042750681">📈</tg-emoji>',
  REFRESH: '<tg-emoji emoji-id="5375338737028841420">🔄</tg-emoji>',
  LOCK: '<tg-emoji emoji-id="5296369303661067030">🔒</tg-emoji>',
  BACK: '<tg-emoji emoji-id="5363896514655564837">⬅️</tg-emoji>',
  HOURGLASS: '<tg-emoji emoji-id="5386367538735104399">⌛</tg-emoji>',
  CARD: '<tg-emoji emoji-id="5472250091332993630">💳</tg-emoji>',
  GAME: '<tg-emoji emoji-id="5409125874651903587">🎮</tg-emoji>',
  SHIELD: '<tg-emoji emoji-id="5251203410396458957">🛡</tg-emoji>',
  SIREN: '<tg-emoji emoji-id="5395695537687123235">🚨</tg-emoji>',
  PIN: '<tg-emoji emoji-id="5397782960512444700">📌</tg-emoji>',
  RECEIPT: '<tg-emoji emoji-id="5444856076954520455">🧾</tg-emoji>',
  PHONE: '<tg-emoji emoji-id="5253655686398629310">📱</tg-emoji>',
  CAMERA: '<tg-emoji emoji-id="5332798318617567350">📸</tg-emoji>',
  QR: '<tg-emoji emoji-id="6169985503006296081">🏦</tg-emoji>',
  DEPOSIT: '<tg-emoji emoji-id="5443127283898405358">📥</tg-emoji>',
  WITHDRAW: '<tg-emoji emoji-id="5445355530111437729">📤</tg-emoji>',
  ONEXBET: '<tg-emoji emoji-id="5427168083074628963">💎</tg-emoji>',
  MELBET: '<tg-emoji emoji-id="5427168083074628963">💎</tg-emoji>',
  BAKONG: '<tg-emoji emoji-id="6298350689525436331">🏦</tg-emoji>',
  ABA: '<tg-emoji emoji-id="6170487786546661553">🏦</tg-emoji>'
};

// Custom Emoji IDs for Buttons
const BTN_ICONS = {
  MEGAPHONE: '5424818078833715060',
  BULB: '5422439311196834318',
  CHAT: '5443038326535759644',
  CHECK: '5206607081334906820',
  SUCCESS: '5280786041324707830',
  CART: '5229064374403998351',
  MONEY: '5409048419211682843',
  CROWN: '5217822164362739968',
  CHART: '5244837092042750681',
  REFRESH: '5375338737028841420',
  GAME: '5409125874651903587',
  PLANE: '5447630114726624483',
  BACK: '5363896514655564837',
  DIAMOND: '5427168083074628963',
  EDIT: '5395444784611480792',
  CANCEL: '5210952531676504517',
  CARD: '5472250091332993630',
  SHIELD: '5251203410396458957',
  CAMERA: '5332798318617567350',
  QR: '6169985503006296081',
  DEPOSIT: '5443127283898405358',
  WITHDRAW: '5445355530111437729',
  ONEXBET: '5427168083074628963',
  MELBET: '5427168083074628963',
  BAKONG: '6298350689525436331',
  ABA: '6170487786546661553'
};

// Admin Configuration
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '6810457857';
const ADMIN_BANK_NAME = process.env.ADMIN_BANK_NAME || 'MAKO H.T';
const ADMIN_ABA_NAME = process.env.ADMIN_ABA_NAME || ADMIN_BANK_NAME;
const ADMIN_BAKONG_NAME = process.env.ADMIN_BAKONG_NAME || 'MAKO CAMBO';

function getAdminBankLine(bank = 'aba') {
  const isBakong = String(bank || '').toLowerCase().includes('bakong');
  if (isBakong) {
    return `${ANIM.BAKONG} <b>Bakong : ${ADMIN_BAKONG_NAME}</b>`;
  }
  return `${ANIM.ABA} <b>ABA : ${ADMIN_ABA_NAME}</b>`;
}

function getWithdrawVerifyScreen(userState) {
  const code = userState.withdrawCode || 'N/A';
  const khqr = userState.khqr || {};
  const text =
    `${ANIM.CARD} <b>ផ្ទៀងផ្ទាត់ព័ត៌មានដកប្រាក់ (VERIFY)</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${code}</code>\n` +
    `${ANIM.CARD} <b>ធនាគារ:</b> <b>${khqr.bankName || 'KHQR'}</b>\n` +
    `${khqr.accountName ? `👤 <b>ឈ្មោះគណនី:</b> <b>${khqr.accountName}</b>\n` : ''}` +
    `${khqr.accountId ? `💳 <b>គណនី/សម្គាល់:</b> <b>${khqr.accountId}</b>\n` : ''}` +
    `━━━━━━━━━━━━━━━\n` +
    `⚠️ <i>សូមចុច <b>"យល់ព្រម / ផ្ញើសំណើ"</b> ដើម្បីបញ្ជូន!</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'យល់ព្រម / ផ្ញើសំណើ',
          callback_data: 'wd_confirm_submit',
          icon_custom_emoji_id: BTN_ICONS.SUCCESS,
          style: 'success'
        }
      ],
      [
        {
          text: 'កែប្រែ Code 4 ខ្ទង់',
          callback_data: 'wd_edit_code',
          icon_custom_emoji_id: BTN_ICONS.EDIT,
          style: 'primary'
        },
        {
          text: 'ប្តូររូបភាព QR Code',
          callback_data: 'wd_edit_qr',
          icon_custom_emoji_id: BTN_ICONS.QR,
          style: 'primary'
        }
      ],
      [
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  return { text, reply_markup };
}

const USERS_FILE_PATH = path.join(__dirname, 'users.json');

const ADMIN_IDS = new Set([
  '6810457857',
  '8730273904',
  '7283817695',
  ...(process.env.ADMIN_CHAT_ID ? [String(process.env.ADMIN_CHAT_ID)] : []),
  ...(process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(s => s.trim()) : [])
]);

function isAdmin(id) {
  if (!id) return false;
  return ADMIN_IDS.has(String(id));
}

// In-memory Database & Sessions
const usersDb = new Map();
const userStates = new Map(); // tracks user input modes (e.g., custom amount, broadcast)
const pendingTxs = new Map(); // tracks active QR payments & countdown timers
const userActiveMsgs = new Map(); // tracks last active bot message id to delete & replace cleanly
const topupRequests = new Map(); // tracks completed payments waiting for admin to add funds
const withdrawRequests = new Map(); // tracks pending withdrawal requests waiting for admin to process
const abaDeeplinks = new Map(); // tracks ABA dynamic deeplinks & QR strings for instant app redirect

// Anti-Duplicate & Race Condition Locks (Never allow duplicate notifications or processing)
const processedTopupTrans = new Set();
const checkingTopupTxs = new Set();

const TOPUP_REQUESTS_FILE_PATH = path.join(__dirname, 'topup_requests.json');

function loadTopupRequestsFromDisk() {
  try {
    if (fs.existsSync(TOPUP_REQUESTS_FILE_PATH)) {
      const raw = fs.readFileSync(TOPUP_REQUESTS_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.tranId) {
            topupRequests.set(item.tranId, item);
            processedTopupTrans.add(item.tranId);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading topup_requests.json:', err.message);
  }
}

function saveTopupRequestsToDisk() {
  try {
    const list = Array.from(topupRequests.values());
    fs.writeFileSync(TOPUP_REQUESTS_FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving topup_requests.json:', err.message);
  }
}

const WITHDRAW_REQUESTS_FILE_PATH = path.join(__dirname, 'withdraw_requests.json');

function loadWithdrawRequestsFromDisk() {
  try {
    if (fs.existsSync(WITHDRAW_REQUESTS_FILE_PATH)) {
      const raw = fs.readFileSync(WITHDRAW_REQUESTS_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.withdrawId) {
            withdrawRequests.set(item.withdrawId, item);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading withdraw_requests.json:', err.message);
  }
}

function saveWithdrawRequestsToDisk() {
  try {
    const list = Array.from(withdrawRequests.values());
    fs.writeFileSync(WITHDRAW_REQUESTS_FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving withdraw_requests.json:', err.message);
  }
}

// ---------------- TRANSACTION HISTORY SYSTEM (TODAY / YESTERDAY / ALL) ----------------
const HISTORY_FILE_PATH = path.join(__dirname, 'history.json');
let transactionsHistory = [];

function getCambodiaDateKey(date = new Date()) {
  const d = (date instanceof Date) ? date : new Date(date);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' }); // returns YYYY-MM-DD
}

function loadHistoryFromDisk() {
  try {
    if (fs.existsSync(HISTORY_FILE_PATH)) {
      const raw = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        transactionsHistory = data;
        for (const item of data) {
          if (item && item.id) {
            processedTopupTrans.add(item.id);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading history.json:', err.message);
  }
}

function saveHistoryToDisk() {
  try {
    fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify(transactionsHistory, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving history.json:', err.message);
  }
}

function addHistoryRecord(record) {
  if (!record || !record.id) return;
  record.timestamp = record.timestamp || Date.now();
  record.dateKey = record.dateKey || getCambodiaDateKey(new Date(record.timestamp));
  record.displayDate = record.displayDate || new Date(record.timestamp).toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' });

  const idx = transactionsHistory.findIndex(h => h.id === record.id);
  if (idx >= 0) {
    transactionsHistory[idx] = { ...transactionsHistory[idx], ...record };
  } else {
    transactionsHistory.unshift(record);
  }
  if (transactionsHistory.length > 500) {
    transactionsHistory = transactionsHistory.slice(0, 500);
  }
  saveHistoryToDisk();
}

function updateHistoryStatus(id, newStatus) {
  const item = transactionsHistory.find(h => h.id === id);
  if (item) {
    item.status = newStatus;
    item.updatedAt = Date.now();
    saveHistoryToDisk();
  }
}

function getHistoryForUser(userId, filter = 'today', isUserAdmin = false) {
  const todayKey = getCambodiaDateKey(new Date());
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const ytdKey = getCambodiaDateKey(yesterday);

  return transactionsHistory.filter(item => {
    if (!isUserAdmin && String(item.userId) !== String(userId)) return false;

    if (filter === 'today') {
      return item.dateKey === todayKey;
    } else if (filter === 'ytd') {
      return item.dateKey === ytdKey;
    }
    return true; // 'all'
  });
}

function getHistoryScreen(userId, filter = 'today', isUserAdmin = false) {
  const list = getHistoryForUser(userId, filter, isUserAdmin);

  const filterTitle = filter === 'today'
    ? '📅 ថ្ងៃនេះ (Today)'
    : (filter === 'ytd' ? '📆 ម្សិលមិញ (Yesterday)' : '📋 ទាំងអស់ (All History)');

  const roleTitle = isUserAdmin ? ' 👑 (Admin View)' : '';

  let text =
    `${ANIM.CHART} <b>ប្រវត្តិប្រតិបត្តិការ (TRANSACTIONS HISTORY)${roleTitle}</b>\n` +
    `🔍 <b>តម្រង:</b> <code>${filterTitle}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  if (list.length === 0) {
    text += `\n<i>${ANIM.WARN} មិនមានប្រវត្តិប្រតិបត្តិការសម្រាប់ "${filterTitle}" ឡើយ!</i>\n`;
  } else {
    const displayList = list.slice(0, 10);
    displayList.forEach((item, idx) => {
      const isTopup = item.type === 'topup';
      const typeIcon = isTopup ? ANIM.DEPOSIT : ANIM.WITHDRAW;
      const typeName = isTopup ? 'បញ្ចូលប្រាក់ (Top-Up)' : 'ដកប្រាក់ (Withdraw)';

      let statusBadge = '⏳ កំពុងរង់ចាំ (Pending)';
      if (item.status === 'COMPLETED') statusBadge = '✅ ជោគជ័យ (Done)';
      if (item.status === 'REJECTED') statusBadge = '❌ បានបដិសេធ (Cancelled)';

      text += `\n<b>#${idx + 1}. ${typeIcon} ${typeName}</b>\n`;
      if (isTopup) {
        text += `${ANIM.ONEXBET} <b>ID 1xBet:</b> <code>${item.oneXBetId || 'N/A'}</code>\n`;
        text += `${ANIM.MONEY} <b>ចំនួនទឹកប្រាក់:</b> <b>+$${Number(item.amount || 0).toFixed(2)} USD</b>\n`;
        text += `${ANIM.CARD} <b>ធនាគារ:</b> <b>${item.bank ? item.bank.toUpperCase() : 'KHQR'}</b>\n`;
        text += `${ANIM.RECEIPT} <b>វិក្កយបត្រ:</b> <b>${item.id}</b>\n`;
      } else {
        text += `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${item.code || 'N/A'}</code>\n`;
        text += `${ANIM.CARD} <b>ធនាគារ:</b> <b>${item.bank || 'KHQR'}</b>\n`;
        if (item.accountName) text += `👤 <b>ឈ្មោះ:</b> <b>${item.accountName}</b>\n`;
        text += `${ANIM.RECEIPT} <b>Withdraw ID:</b> <b>${item.id}</b>\n`;
      }
      if (isUserAdmin && item.name) {
        text += `${ANIM.USER} <b>អតិថិជន:</b> ${item.name} (${item.username || 'គ្មាន'})\n`;
      }
      text += `⚡️ <b>ស្ថានភាព:</b> ${statusBadge}\n`;
      text += `🕒 <b>កាលបរិច្ឆេទ:</b> <b>${item.displayDate}</b>\n`;
      text += `──────────────────`;
    });

    if (list.length > 10) {
      text += `\n<i>... និងមានចំនួន ${list.length - 10} ប្រតិបត្តិការផ្សេងទៀត</i>\n`;
    }
  }

  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 <i>ជ្រើសរើសប៊ូតុងខាងក្រោមដើម្បីពិនិត្យមើលតាមកាលបរិច្ឆេទ៖</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: filter === 'today' ? '• 📅 ថ្ងៃនេះ •' : '📅 ថ្ងៃនេះ (Today)',
          callback_data: 'hist_today',
          style: filter === 'today' ? 'success' : 'primary'
        },
        {
          text: filter === 'ytd' ? '• 📆 ម្សិលមិញ •' : '📆 ម្សិលមិញ (YTD)',
          callback_data: 'hist_ytd',
          style: filter === 'ytd' ? 'success' : 'primary'
        },
        {
          text: filter === 'all' ? '• 📋 ទាំងអស់ •' : '📋 ទាំងអស់ (All)',
          callback_data: 'hist_all',
          style: filter === 'all' ? 'success' : 'primary'
        }
      ],
      [
        {
          text: 'ដាក់ប្រាក់ (Topup)',
          callback_data: 'menu_topup',
          icon_custom_emoji_id: BTN_ICONS.DEPOSIT,
          style: 'success'
        },
        {
          text: 'ដកប្រាក់ (Withdraw)',
          callback_data: 'menu_withdraw',
          icon_custom_emoji_id: BTN_ICONS.WITHDRAW,
          style: 'primary'
        }
      ],
      [
        {
          text: 'ទៅកាន់ Menu ចម្បង',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'danger'
        }
      ]
    ]
  };

  return { text, reply_markup };
}

function syncExistingRequestsToHistory() {
  for (const [wId, w] of withdrawRequests.entries()) {
    if (!transactionsHistory.some(h => h.id === wId)) {
      transactionsHistory.push({
        id: wId,
        type: 'withdraw',
        userId: w.userId,
        name: w.name,
        username: w.username,
        code: w.code,
        bank: w.bank,
        accountName: w.accountName,
        accountId: w.accountId,
        status: 'PENDING',
        timestamp: Date.now(),
        dateKey: getCambodiaDateKey(new Date()),
        displayDate: w.date || new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
      });
    }
  }
  for (const [tId, t] of topupRequests.entries()) {
    if (!transactionsHistory.some(h => h.id === tId)) {
      transactionsHistory.push({
        id: tId,
        type: 'topup',
        userId: t.userId,
        name: t.name,
        username: t.username,
        oneXBetId: t.oneXBetId,
        amount: t.amount,
        bank: t.bank,
        status: 'PENDING',
        timestamp: Date.now(),
        dateKey: getCambodiaDateKey(new Date()),
        displayDate: t.date || new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
      });
    }
  }
  saveHistoryToDisk();
}

// Auto-recover topup details from message text if memory was cleared or server restarted
function parseTopupFromMessage(rawText, tranId = '') {
  const text = String(rawText || '').replace(/<[^>]*>?/gm, '');
  const idMatch = text.match(/ID 1xBet:\s*(\d+)/i) || text.match(/1xBet:\s*(\d+)/i);
  const amtMatch = text.match(/ចំនួនទឹកប្រាក់:[^0-9]*([0-9]+(?:\.[0-9]+)?)/i) || text.match(/\+?\$?([0-9\.]+)\s*USD/i);
  const userMatch = text.match(/Telegram ID:\s*(\d+)/i);
  const nameMatch = text.match(/អតិថិជន:\s*([^(\n]+)/i);
  const usernameMatch = text.match(/@([a-zA-Z0-9_]+)/i);
  const tranMatch = text.match(/លេខវិក្កយបត្រ:\s*([a-zA-Z0-9_]+)/i);
  const dateMatch = text.match(/កាលបរិច្ឆេទ:\s*([^\n]+)/i);

  const isAba = /ABA\s*:/i.test(text);
  const isBakong = /Bakong\s*:/i.test(text);
  const detectedBank = isBakong ? 'bakong' : (isAba ? 'aba' : 'aba');

  const finalId = idMatch ? idMatch[1] : 'N/A';
  const finalUserId = userMatch ? Number(userMatch[1]) : 0;
  const finalAmount = amtMatch ? parseFloat(amtMatch[1]) : 0;
  const waitMatch = String(rawText || '').match(/tg:\/\/waitId\/(\d+)/);
  const finalWaitId = waitMatch ? Number(waitMatch[1]) : null;

  return {
    tranId: tranId || (tranMatch ? tranMatch[1] : `TX-${Date.now()}`),
    userId: finalUserId,
    chatId: finalUserId,
    userWaitMsgId: finalWaitId,
    name: nameMatch ? nameMatch[1].replace(/<[^>]*>?/gm, '').trim() : 'Customer',
    username: usernameMatch ? `@${usernameMatch[1]}` : '',
    oneXBetId: finalId,
    amount: finalAmount,
    currency: 'USD',
    bank: detectedBank,
    date: dateMatch ? dateMatch[1].trim() : new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
  };
}

function parseWithdrawFromMessage(rawText, withdrawId = '') {
  const text = String(rawText || '').replace(/<[^>]*>?/gm, '');
  const userMatch = text.match(/Telegram ID:\s*(\d+)/i);
  const codeMatch = text.match(/Code(?:\s*4\s*ខ្ទង់)?:\s*([a-zA-Z0-9]+)/i);
  const nameMatch = text.match(/អតិថិជន:\s*([^(\n]+)/i);
  const usernameMatch = text.match(/@([a-zA-Z0-9_]+)/i);
  const wdMatch = text.match(/Withdraw ID:\s*([a-zA-Z0-9_]+)/i);
  const bankMatch = text.match(/ធនាគារ:\s*([^\n]+)/i);
  const acctNameMatch = text.match(/ឈ្មោះគណនី:\s*([^\n]+)/i);
  const acctIdMatch = text.match(/គណនី\/សម្គាល់:\s*([^\n]+)/i);

  const finalUserId = userMatch ? Number(userMatch[1]) : 0;
  return {
    withdrawId: withdrawId || (wdMatch ? wdMatch[1] : `WD-${Date.now()}`),
    userId: finalUserId,
    chatId: finalUserId,
    name: nameMatch ? nameMatch[1].replace(/<[^>]*>?/gm, '').trim() : 'Customer',
    username: usernameMatch ? `@${usernameMatch[1]}` : '',
    code: codeMatch ? codeMatch[1] : 'N/A',
    bank: bankMatch ? bankMatch[1].trim() : 'Bakong / ABA KHQR',
    accountName: acctNameMatch ? acctNameMatch[1].trim() : '',
    accountId: acctIdMatch ? acctIdMatch[1].trim() : '',
    date: new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
  };
}

// Load persisted requests and history from disk
loadTopupRequestsFromDisk();
loadWithdrawRequestsFromDisk();
loadHistoryFromDisk();
syncExistingRequestsToHistory();

function loadUsersFromDisk() {
  try {
    if (fs.existsSync(USERS_FILE_PATH)) {
      const raw = fs.readFileSync(USERS_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const u of data) {
          if (u && u.id) {
            usersDb.set(Number(u.id), u);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error loading users.json:', err.message);
  }
}

function saveUsersToDisk() {
  try {
    const list = Array.from(usersDb.values());
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving users.json:', err.message);
  }
}

// Load users from storage
loadUsersFromDisk();

function getUser(id, firstName = 'User', username = '') {
  const numericId = Number(id);
  if (!usersDb.has(numericId)) {
    usersDb.set(numericId, {
      id: numericId,
      name: firstName || 'User',
      username: username ? (username.startsWith('@') ? username : `@${username}`) : '',
      balance: 0.00,
      joinedAt: new Date().toLocaleDateString('km-KH', { timeZone: 'Asia/Phnom_Penh' }),
      orders: []
    });
    saveUsersToDisk();
  } else {
    const user = usersDb.get(numericId);
    let changed = false;
    if (firstName && user.name !== firstName) {
      user.name = firstName;
      changed = true;
    }
    const cleanUsername = username ? (username.startsWith('@') ? username : `@${username}`) : '';
    if (cleanUsername && user.username !== cleanUsername) {
      user.username = cleanUsername;
      changed = true;
    }
    if (changed) saveUsersToDisk();
  }
  return usersDb.get(numericId);
}

// Ensure Admin is always registered
getUser(6810457857, 'hengly', '@ma_ko168');
if (String(ADMIN_CHAT_ID) !== '6810457857') getUser(ADMIN_CHAT_ID, 'Admin');
getUser(7283817695, 'Kai Zen', '@kaixite');

/**
 * Atomic & Deduplicated Top-Up Processor
 * Guarantees that a transaction is processed and sent to Admin EXACTLY ONCE!
 */
async function processSuccessfulTopup(tranId) {
  if (!tranId) return { success: false, error: 'No tranId provided' };

  // 1. Strict deduplication check: if already processed, NEVER repeat
  if (processedTopupTrans.has(tranId)) {
    console.log(`[Topup Dedup Guard] Transaction ${tranId} already processed. Suppressing duplicate notification.`);
    return { success: true, alreadyProcessed: true };
  }
  // Immediately lock transaction before any async operations
  processedTopupTrans.add(tranId);

  const tx = pendingTxs.get(tranId);
  if (!tx) {
    console.warn(`[Topup Dedup Guard] No pending transaction found for ${tranId}`);
    return { success: false, error: 'Transaction not found or expired' };
  }

  // Clear timers and remove from active pending map
  if (tx.pollInterval) clearInterval(tx.pollInterval);
  if (tx.timerId) clearTimeout(tx.timerId);
  pendingTxs.delete(tranId);

  // 2. Update user state
  const user = getUser(tx.userId, tx.name || 'User', tx.username);
  user.balance += tx.usdAmount;
  user.orders.push({
    item: `1xBet Top-Up (ID: ${tx.oneXBetId}) ($${tx.usdAmount.toFixed(2)} USD)`,
    price: tx.usdAmount,
    date: new Date().toLocaleDateString('km-KH')
  });
  saveUsersToDisk();

  // 3. Save request for Admin to Add Funds
  topupRequests.set(tranId, {
    tranId,
    userId: tx.userId,
    chatId: tx.chatId || tx.userId,
    name: user.name,
    username: tx.username,
    oneXBetId: tx.oneXBetId,
    amount: tx.usdAmount,
    currency: tx.currency || 'USD',
    chargeAmount: tx.chargeAmount || tx.usdAmount,
    bank: tx.bank || 'aba',
    date: new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
  });
  saveTopupRequestsToDisk();

  // 4. Save to persistent history
  addHistoryRecord({
    id: tranId,
    type: 'topup',
    userId: tx.userId,
    chatId: tx.chatId || tx.userId,
    name: user.name,
    username: tx.username,
    oneXBetId: tx.oneXBetId,
    amount: tx.usdAmount,
    bank: tx.bank || 'aba',
    status: 'PENDING'
  });

  // 5. Notify User in Telegram (Delete QR and show success wait message)
  const paidAmtDesc = (tx.currency === 'KHR')
    ? `+${Math.round(tx.chargeAmount || (tx.usdAmount * 4100)).toLocaleString()} ៛ KHR ($${tx.usdAmount.toFixed(2)} USD)`
    : `+$${tx.usdAmount.toFixed(2)} USD`;

  const successCaption =
    `${ANIM.HOURGLASS} <b>សូមរង់ចាំបន្តិច...</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.ONEXBET} <b>ID 1xBet:</b> <code>${tx.oneXBetId}</code>\n` +
    `${ANIM.LIGHTNING} <b>ទឹកប្រាក់បង់:</b> <b>${paidAmtDesc}</b>\n` +
    `${ANIM.MONEY} <b>សមតុល្យ:</b> <b>$${user.balance.toFixed(2)} USD</b>\n` +
    `🔷 <b>វិក្កយបត្រ:</b> <b>${tx.tranId}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🌀 <i><b>ទឹកប្រាក់កំពុងបញ្ចូលទៅ 1xBet...</b></i>`;

  const successMarkup = {
    inline_keyboard: [
      [
        {
          text: 'ទៅកាន់ Menu ចម្បង',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.DIAMOND,
          style: 'primary'
        }
      ]
    ]
  };

  let sentSuccess = null;
  const targetChatId = tx.chatId || tx.userId;
  if (targetChatId) {
    if (tx.msgId) {
      // Bot flow: delete QR code photo so user cannot scan again
      await bot.telegram.deleteMessage(targetChatId, tx.msgId).catch(() => {});
    }
    try {
      sentSuccess = await bot.telegram.sendMessage(targetChatId, successCaption, {
        parse_mode: 'HTML',
        reply_markup: successMarkup
      });

      if (sentSuccess?.message_id) {
        userActiveMsgs.set(targetChatId, sentSuccess.message_id);
        const r = topupRequests.get(tranId);
        if (r) {
          r.userWaitMsgId = sentSuccess.message_id;
          saveTopupRequestsToDisk();
        }
      }
    } catch (sendErr) {
      console.warn(`[Topup Notification] Could not send confirmation to user ${targetChatId}: ${sendErr.message}`);
    }
  }

  // 6. Notify Admin Top-Up Group ONCE ONLY (Image 1 Format)
  const userHandle = (tx.username && tx.username !== 'គ្មាន' && tx.username !== '@គ្មាន')
    ? ` (${tx.username.startsWith('@') ? tx.username : `@${tx.username}`})`
    : '';

  const hiddenWaitLink = sentSuccess?.message_id
    ? `<a href="tg://waitId/${sentSuccess.message_id}">&#8203;</a>`
    : '';

  const adminTopupText =
    `${ANIM.CARD} <b>MAKO CAMBO BOT</b>${hiddenWaitLink}\n` +
    `${ANIM.SUCCESS} <b>បានបញ្ចូលទឹកប្រាក់ជោគជ័យ</b>\n\n` +
    `${getAdminBankLine(tx.bank)}\n` +
    `${ANIM.DIAMOND} <b>ID 1xBet:</b> <code>${tx.oneXBetId}</code>\n` +
    `${ANIM.MONEY} <b>ចំនួនទឹកប្រាក់:</b> <b>+$${tx.usdAmount.toFixed(2)} USD</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.CROWN} <b>អតិថិជន:</b> <a href="tg://user?id=${tx.userId}">${user.name || 'User'}</a>${userHandle}\n` +
    `${ANIM.INFO} <b>Telegram ID:</b> <code>${tx.userId}</code>\n` +
    `${ANIM.RECEIPT} <b>លេខវិក្កយបត្រ:</b> <code>${tx.tranId}</code>\n` +
    `<b>កាលបរិច្ឆេទ:</b> <code>${new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })}</code>`;

  const adminTopupMarkup = {
    inline_keyboard: [
      [
        {
          text: 'បញ្ចូលជោគជ័យ (Done)',
          callback_data: `adm_td_${tx.tranId}`,
          icon_custom_emoji_id: BTN_ICONS.SUCCESS,
          style: 'success'
        },
        {
          text: 'បដិសេធ (Cancel)',
          callback_data: `adm_tc_${tx.tranId}`,
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  if (ADMIN_TOPUP_GROUP_ID) {
    try {
      await bot.telegram.sendMessage(ADMIN_TOPUP_GROUP_ID, adminTopupText, {
        parse_mode: 'HTML',
        reply_markup: adminTopupMarkup
      });
      console.log(`✅ [TopUp Alert] Successfully alerted Admin Top-Up Group (${ADMIN_TOPUP_GROUP_ID}) for tranId: ${tx.tranId}, Amount: $${tx.usdAmount}`);
    } catch (err) {
      console.error(`❌ Failed to send top-up to admin group (${ADMIN_TOPUP_GROUP_ID}):`, err.message);
    }
  } else {
    console.warn('⚠️ [TopUp Alert] ADMIN_TOPUP_GROUP_ID is not configured!');
  }

  return { success: true, tx };
}

/**
 * Verify 1xBet Player ID:
 * - Checks format (must be numeric, between 6 and 11 digits)
 * - Queries MobCash API if configured
 * - Searches usersDb to find player name or historical match
 * - If not found/invalid, returns { found: false }
 * - If found, returns { found: true, playerName, oneXBetId }
 */
async function verifyOneXBetId(oneXBetId, telegramUser = null) {
  const cleanedId = String(oneXBetId || '').trim();

  // 1. Must be purely numeric and between 6 and 11 digits
  // Rejects letters (like 'asdasd'), symbols, or numbers < 6 or > 11 digits
  if (!/^\d{6,11}$/.test(cleanedId)) {
    return {
      found: false,
      reason: 'INVALID_FORMAT',
      message: 'ID 1xBet ត្រូវតែជាលេខសុទ្ធពី 6 ដល់ 11 ខ្ទង់'
    };
  }

  // Reject dummy sequences like '000000', '111111', etc.
  if (/^(\d)\1{5,}$/.test(cleanedId)) {
    return {
      found: false,
      reason: 'DUMMY_ID',
      message: 'ID មិនត្រឹមត្រូវ'
    };
  }

  // 2. Query external MobCash Cashier API if configured
  if (MOBCASH_API_URL) {
    try {
      const apiUrl = MOBCASH_API_URL.replace(/\/+$/, '') + `/api/find-user?id=${encodeURIComponent(cleanedId)}`;
      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${MOBCASH_CASHIER_KEY}`,
          'x-api-key': MOBCASH_CASHIER_KEY
        },
        timeout: 5000
      });
      if (res.ok) {
        const data = await res.json();
        if (data.found === false) {
          return { found: false, reason: 'NOT_FOUND_IN_APP' };
        }
        return {
          found: true,
          playerName: data.name || data.playerName || (telegramUser?.first_name || '1xBet Member'),
          oneXBetId: cleanedId
        };
      }
    } catch (e) {
      console.warn('[MobCash Check ID API Warning]:', e.message);
    }
  }

  // 3. Search history in usersDb for recorded player names with this ID
  let matchedName = null;
  for (const u of usersDb.values()) {
    if (u.orders) {
      for (const order of u.orders) {
        if (order.item && order.item.includes(cleanedId)) {
          matchedName = u.name;
          break;
        }
      }
    }
    if (matchedName) break;
  }

  // Resolved user name: either past matched name or Telegram customer's name
  const resolvedName = matchedName || (telegramUser?.first_name ? `${telegramUser.first_name}${telegramUser.username ? ' (@' + telegramUser.username.replace('@', '') + ')' : ''}` : '1xBet VIP Player');

  return {
    found: true,
    playerName: resolvedName,
    oneXBetId: cleanedId
  };
}

/**
 * Clean In-Place Message Display:
 * Removes the old message and shows the new one, or edits in-place so chat never stacks up!
 */
async function showScreen(ctx, { text, reply_markup, photo = null, video = null, videoKey = null, photoKey = null }) {
  const chatId = ctx.chat.id;
  const oldMsgId = userActiveMsgs.get(chatId);

  // 1. Text-to-Text edit (Instant, 0ms)
  if (ctx.callbackQuery && !photo && !video && ctx.callbackQuery.message && !ctx.callbackQuery.message.photo && !ctx.callbackQuery.message.video) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup });
      userActiveMsgs.set(chatId, ctx.callbackQuery.message.message_id);
      return;
    } catch (e) {
      // If edit fails, fall through to delete and replace
    }
  }

  // 2. Video-to-Video or Video-to-Menu caption edit (Instant, 0ms, zero reload)
  if (ctx.callbackQuery && !photo && ctx.callbackQuery.message?.video) {
    try {
      await ctx.editMessageCaption(text, { parse_mode: 'HTML', reply_markup });
      userActiveMsgs.set(chatId, ctx.callbackQuery.message.message_id);
      return;
    } catch (e) {
      // If edit caption fails, fall through to delete and replace
    }
  }

  // Delete previous bot message(s) to keep chat completely clean (no stacking up/down)
  const toDelete = new Set();
  if (oldMsgId) toDelete.add(oldMsgId);
  if (ctx.callbackQuery?.message?.message_id) toDelete.add(ctx.callbackQuery.message.message_id);
  for (const mid of toDelete) {
    await ctx.telegram.deleteMessage(chatId, mid).catch(() => { });
  }

  // Send new message
  let sent;
  if (video) {
    try {
      if (typeof video === 'string') {
        // Direct Telegram CDN cache send -> 0.05 seconds
        sent = await ctx.replyWithVideo(video, {
          caption: text,
          parse_mode: 'HTML',
          reply_markup
        });
      } else {
        if (typeof video === 'object' && video?.source) {
          ctx.sendChatAction('upload_video').catch(() => { });
        }
        sent = await ctx.replyWithVideo(video, {
          caption: text,
          parse_mode: 'HTML',
          reply_markup
        });
      }

      if (sent?.video?.file_id) {
        const fid = sent.video.file_id;
        if (videoKey === 'welcome' || !videoKey) {
          cachedWelcomeVideoFileId = fid;
          mediaCache.welcomeVideoFileId = fid;
        } else if (videoKey === 'addfunds') {
          cachedAddFundsVideoFileId = fid;
          mediaCache.addFundsVideoFileId = fid;
        } else if (videoKey === 'withdraw') {
          cachedWithdrawVideoFileId = fid;
          mediaCache.withdrawVideoFileId = fid;
        }
        saveMediaCache();
      }
    } catch (err) {
      console.warn("Could not send video, falling back to text:", err.message);
      sent = await ctx.replyWithHTML(text, { reply_markup });
    }
  } else if (photo) {
    try {
      sent = await ctx.replyWithPhoto(photo, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup
      });
      if (photoKey === 'logo' && sent?.photo && sent.photo.length > 0) {
        cachedLogoPhotoFileId = sent.photo[sent.photo.length - 1].file_id;
        mediaCache.logoPhotoFileId = cachedLogoPhotoFileId;
        saveMediaCache();
      }
    } catch (err) {
      console.warn("Could not send photo, falling back to text:", err.message);
      sent = await ctx.replyWithHTML(text, { reply_markup });
    }
  } else {
    sent = await ctx.replyWithHTML(text, { reply_markup });
  }

  if (sent?.message_id) {
    userActiveMsgs.set(chatId, sent.message_id);
  }
  return sent;
}

// ---------------- DIRECT ABA PAYWAY & BAKONG PAYMENT FUNCTIONS ----------------

function sha512Hex(str) {
  return crypto.createHash('sha512').update(str, 'utf8').digest('hex');
}

function hmacSha512Hex(str, key) {
  return crypto.createHmac('sha512', key).update(str, 'utf8').digest('hex');
}

function generatePaywayDeviceId(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function generateAbaPaywayPayment(amount, currency = 'USD') {
  const finalAmount = parseFloat(amount).toFixed(2);
  const paywayUrl = (process.env.ABA_PAYWAY_URL || 'https://link.payway.com.kh/a3550666t').trim();

  const resp = await fetch(paywayUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });

  if (!resp.ok) {
    throw new Error(`ABA PayWay link returned HTTP ${resp.status}`);
  }

  const html = await resp.text();
  const m = html.match(/<script(?![^>]*src)[^>]*>(window\.__NUXT__[\s\S]*?)<\/script>/);
  if (!m) {
    throw new Error('Could not parse PayWay NUXT state from merchant link');
  }

  const vm = require('node:vm');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox);

  const initialData = sandbox.window.__NUXT__;
  const paymentLinkData = initialData?.data?.[0]?.data;
  const initialAbaData = paymentLinkData?.aba_data;
  const stateRequestTime = initialData?.state?.request_time;

  if (!initialAbaData || !stateRequestTime) {
    throw new Error('Missing initial PayWay session data');
  }

  const merchantName = paymentLinkData?.transaction_summary?.merchant?.company || ADMIN_ABA_NAME || 'MAKO by H.T';

  // Step 1: list-payment-options
  const additionalFields = JSON.stringify({ amount: String(finalAmount) });
  const hash1 = sha512Hex(stateRequestTime + initialAbaData + additionalFields);

  const res1 = await fetch('https://link.payway.com.kh/api/pw-app/v1/payment/gateway/list-payment-options', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Language': 'en',
      'Origin': 'https://link.payway.com.kh',
      'Referer': paywayUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      additional_fields: additionalFields,
      request_time: stateRequestTime,
      aba_data: initialAbaData,
      hash: hash1
    })
  });

  const data1 = await res1.json();
  if (!data1.token) {
    throw new Error(`PayWay list-payment-options error: ${JSON.stringify(data1.status || data1)}`);
  }

  // Step 2: request qr
  const hash2 = hmacSha512Hex(stateRequestTime + data1.aba_data, data1.token);
  const res2 = await fetch('https://link.payway.com.kh/api/pw-app/v1/payment/gateway/abapay-khqr/request-qr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Language': 'en',
      'Origin': 'https://link.payway.com.kh',
      'Referer': paywayUrl,
      'token': data1.token,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      request_time: stateRequestTime,
      aba_data: data1.aba_data,
      hash: hash2
    })
  });

  const data2 = await res2.json();
  if (!data2.qr_string) {
    throw new Error(`PayWay request-qr error: ${JSON.stringify(data2.status || data2)}`);
  }

  const tranId = data2.status?.tran_id || `ABA-${Date.now()}`;
  const qrString = data2.qr_string;
  const clientId = data2.client_id || data1.client_id;
  const token = data2.token || data1.token;
  const deviceId = generatePaywayDeviceId(10);
  const deepLink = `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(qrString)}`;
  const androidIntent = `intent://ababank.com?type=payway&qrcode=${encodeURIComponent(qrString)}#Intent;scheme=abamobilebank;package=com.ababank.mobile;end`;

  return {
    success: true,
    bank: 'ABA',
    merchantName,
    amount: parseFloat(finalAmount),
    amountFormatted: finalAmount,
    currency,
    tranId,
    transactionId: tranId,
    billNumber: tranId,
    qrString,
    deepLink,
    androidIntent,
    token,
    clientId,
    deviceId,
    stateRequestTime,
    paywayUrl
  };
}

async function checkAbaPaymentStatus(token, clientId, stateRequestTime, deviceId) {
  const devId = deviceId || '1234567890';
  const hash = sha512Hex(clientId + devId + stateRequestTime);
  const paywayUrl = (process.env.ABA_PAYWAY_URL || 'https://link.payway.com.kh/a3550666t').trim();

  const resp = await fetch('https://link.payway.com.kh/api/pw-app/v1/payment-link/check-payment-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Language': 'en',
      'token': token,
      'Origin': 'https://link.payway.com.kh',
      'Referer': paywayUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      request_time: stateRequestTime,
      client_id: clientId,
      device_id: devId,
      hash
    })
  });

  if (!resp.ok) {
    return { success: false, paid: false, status: 'PENDING' };
  }

  const json = await resp.json();
  const action = (json?.data?.action || '').toLowerCase();
  const isPaid = action === 'approved';

  return {
    success: true,
    paid: isPaid,
    status: isPaid ? 'PAID' : 'PENDING',
    action,
    raw: json
  };
}

async function generateKHQR(amount, currency = 'USD', bank = 'aba') {
  const isAba = String(bank).toLowerCase() === 'aba';

  if (isAba) {
    try {
      const abaResult = await generateAbaPaywayPayment(amount, currency);
      return abaResult;
    } catch (abaErr) {
      console.error('⚠️ ABA PayWay generation error:', abaErr.message);
      throw new Error(`ABA QR Generation Error: ${abaErr.message}`);
    }
  }

  const endpoint = String(bank).toLowerCase() === 'bakong' ? 'bakong' : 'aba';
  const url = `${PAYLINK_BASE_URL}/api/${endpoint}/generate-qr`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': PAYLINK_API_KEY,
      'x-secret': PAYLINK_SECRET
    },
    body: JSON.stringify({ amount: parseFloat(amount), currency })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayLinkAPI error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  data.bank = 'BAKONG';
  return data;
}

async function checkPaymentStatus(tranId, md5, tx = null) {
  const transaction = tx || pendingTxs.get(tranId);
  if (transaction && transaction.bank === 'aba' && transaction.token && transaction.clientId) {
    try {
      const abaRes = await checkAbaPaymentStatus(
        transaction.token,
        transaction.clientId,
        transaction.stateRequestTime,
        transaction.deviceId
      );
      if (abaRes.paid || abaRes.status === 'PAID') {
        return { success: true, paid: true, status: 'PAID' };
      }
      return { success: true, paid: false, status: 'PENDING' };
    } catch (err) {
      console.warn('ABA status check error:', err.message);
      return { success: true, paid: false, status: 'PENDING' };
    }
  }

  const targetMd5 = md5 || transaction?.md5;
  const url = `${PAYLINK_BASE_URL}/api/web/check-payment`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': PAYLINK_API_KEY
    },
    body: JSON.stringify({ tranId, md5: targetMd5 })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayLinkAPI check error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}


async function checkMembership(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(CHANNEL_ID, userId);
    const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
    return {
      isMember: validStatuses.includes(member.status),
      error: null
    };
  } catch (error) {
    const errMsg = error.response?.description || error.message;
    return {
      isMember: false,
      error: errMsg
    };
  }
}

// ---------------- MENUS ----------------

function getForceSubMenu() {
  const text =
    `${ANIM.MEGAPHONE} <b>សូមចូលរួម Channel របស់យើងសិន ដើម្បីប្រើប្រាស់ Bot</b>

${ANIM.BULB} <i>បន្ទាប់ពីចូលរួម សូមចុចប៊ូតុង " ${ANIM.FLOWER} ខ្ញុំបានចូលរួមហើយ " ខាងក្រោម</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'ចូលរួម Channel',
          url: CHANNEL_LINK,
          icon_custom_emoji_id: BTN_ICONS.MEGAPHONE,
          style: 'primary'
        }
      ],
      [
        {
          text: 'ខ្ញុំបានចូលរួមហើយ',
          callback_data: 'verify_joined',
          icon_custom_emoji_id: BTN_ICONS.CHECK,
          style: 'success'
        }
      ]
    ]
  };

  return { text, reply_markup };
}

// Function to broadcast message to all users that started the bot
async function executeBroadcast(ctx, sourceChatId, messageId) {
  const users = Array.from(usersDb.values());
  const total = users.length;
  let sentCount = 0;
  let failedCount = 0;

  const statusMsg = await ctx.reply(
    `🚀 <b>កំពុងចាប់ផ្តើមផ្ញើសារទៅកាន់ Users ទាំង ${total} នាក់...</b>\n${ANIM.HOURGLASS} សូមរង់ចាំបន្តិច...`,
    { parse_mode: 'HTML' }
  ).catch(() => null);

  for (const u of users) {
    try {
      await ctx.telegram.copyMessage(u.id, sourceChatId, messageId);
      sentCount++;
    } catch (err) {
      failedCount++;
    }
    // Prevent Telegram flood rate limits (~25-30 msgs/sec)
    await new Promise(r => setTimeout(r, 45));
  }

  if (statusMsg) {
    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => { });
  }

  // Clean up admin's input message
  await ctx.telegram.deleteMessage(sourceChatId, messageId).catch(() => { });

  const resultText =
    `${ANIM.PARTY} <b>ការផ្ញើសារបានបញ្ចប់ (BROADCAST COMPLETED)!</b>
━━━━━━━━━━━━━━━
👥 <b>ចំនួន Users ទាំងអស់:</b> <code>${total}</code> នាក់
${ANIM.CHECK} <b>ផ្ញើជោគជ័យ:</b> <code>${sentCount}</code> នាក់
${ANIM.WARN} <b>បរាជ័យ (Blocked/Deleted):</b> <code>${failedCount}</code> នាក់
━━━━━━━━━━━━━━━`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'ទៅកាន់ Menu ចម្បង',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.DIAMOND,
          style: 'primary'
        }
      ]
    ]
  };

  return showScreen(ctx, { text: resultText, reply_markup });
}

function getMainMenu(user) {
  const isUserAdmin = isAdmin(user.id);
  const text =
`👏 <b>សូមស្វាគមន៍មកកាន់ MAKO CAMBO BOT</b>
<b>ដាក់ប្រាក់ភ្លាមៗរបស់ 1xBet!</b> <tg-emoji emoji-id="6125447482420759069">1️⃣</tg-emoji>

<tg-emoji emoji-id="5444856076954520455">🧾</tg-emoji> <b>ដាក់ប្រាក់បានលឿន រហ័សដោយស្វ័យប្រវត្តិ គាំទ្រ KHQR ( <tg-emoji emoji-id="6169985503006296081">🏦</tg-emoji> , <tg-emoji emoji-id="6170487786546661553">🏦</tg-emoji> , <tg-emoji emoji-id="6172533457994909503">🏦</tg-emoji> , <tg-emoji emoji-id="6170287194394069506">🏦</tg-emoji> , <tg-emoji emoji-id="6172439166282893092">🏦</tg-emoji> )</b>
⛔️ <b>ហាមបាញ់លុយខ្មែរ ៖ បើបងចង់បង្កើតអាខោនឆាតមក( @ma_ko168 )</b>

<tg-emoji emoji-id="5231102735817918643">👇</tg-emoji> <b>សូមជ្រើសរើសប៊ូតុងខាងក្រោម ដើម្បីបន្ត</b>`;

  const keyboard = [];

  // Top Prominent Mini App Button
  if (activeMiniappUrl && activeMiniappUrl.startsWith('https://')) {
    keyboard.push([
      {
        text: '⌘ បើក App',
        web_app: { url: activeMiniappUrl },
        style: 'primary'
      }
    ]);
  } else {
    keyboard.push([
      {
        text: '⌘ បើក App',
        callback_data: 'menu_open_miniapp',
        style: 'primary'
      }
    ]);
  }

  keyboard.push(
    [
      {
        text: 'ដាក់ប្រាក់',
        callback_data: 'menu_topup',
        icon_custom_emoji_id: BTN_ICONS.DEPOSIT,
        style: 'success'
      },
      {
        text: 'ដកប្រាក់',
        callback_data: 'menu_withdraw',
        icon_custom_emoji_id: BTN_ICONS.WITHDRAW,
        style: 'danger'
      }
    ],
    [
      {
        text: 'របៀបដាក់ប្រាក់',
        callback_data: 'guide_topup',
        icon_custom_emoji_id: BTN_ICONS.BULB
      },
      {
        text: 'របៀបដកប្រាក់',
        callback_data: 'guide_withdraw',
        icon_custom_emoji_id: BTN_ICONS.CARD
      }
    ],
    [
      {
        text: 'ប្រវត្តិប្រតិបត្តិការ (History)',
        callback_data: 'menu_history',
        icon_custom_emoji_id: BTN_ICONS.CHART,
        style: 'primary'
      }
    ],
    [
      {
        text: 'Support',
        url: SUPPORT_LINK,
        icon_custom_emoji_id: BTN_ICONS.CHAT,
        style: 'primary'
      }
    ]
  );

  // If Admin (8730273904), show Admin Broadcast button
  if (isUserAdmin) {
    keyboard.push([
      {
        text: `ផ្ញើសារទៅកាន់ Users ទាំងអស់ (${usersDb.size} នាក់)`,
        callback_data: 'admin_broadcast_menu',
        icon_custom_emoji_id: BTN_ICONS.MEGAPHONE,
        style: 'success'
      }
    ]);
  }

  const reply_markup = { inline_keyboard: keyboard };

  const video = getWelcomeVideo();

  return { text, reply_markup, photo: null, video, videoKey: 'welcome' };
}

// ---------------- GLOBAL STRICT FORCE-SUB MIDDLEWARE & BROADCAST ----------------
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;

  if (userId) {
    getUser(userId, ctx.from?.first_name, ctx.from?.username);
  }

  // Handle Admin Broadcast input (any message: text, photo, video, etc.)
  if (userId && isAdmin(userId) && ctx.message) {
    const userState = userStates.get(userId);
    if (userState?.state === 'AWAITING_BROADCAST_MSG') {
      if (ctx.message.text && ctx.message.text.startsWith('/')) {
        userStates.delete(userId);
        return next();
      }
      userStates.delete(userId);
      return executeBroadcast(ctx, ctx.chat.id, ctx.message.message_id);
    }
  }

  if (ctx.callbackQuery && ctx.callbackQuery.data === 'verify_joined') {
    return next();
  }

  if (!userId) return next();

  if (ctx.chat?.type === 'private') {
    const check = await checkMembership(ctx, userId);

    if (!check.isMember) {
      const { text, reply_markup } = getForceSubMenu();

      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('⚠️ អ្នកត្រូវតែចូលរួម Channel ជាមុនសិន ដើម្បីប្រើប្រាស់ Bot!', { show_alert: true }).catch(() => { });
      }
      return showScreen(ctx, { text, reply_markup });
    }
  }

  // Ensure user always has the latest active Mini App URL configured on their 'MaKo' menu button
  if (ctx.chat?.type === 'private' && activeMiniappUrl && activeMiniappUrl.startsWith('https://')) {
    const key = `${ctx.chat.id}_${activeMiniappUrl}`;
    if (!usersWithLiveMenuButton.has(key)) {
      usersWithLiveMenuButton.add(key);
      bot.telegram.callApi('setChatMenuButton', {
        chat_id: ctx.chat.id,
        menu_button: {
          type: 'web_app',
          text: 'MaKo',
          web_app: { url: activeMiniappUrl }
        }
      }).catch(() => {});
    }
  }

  return next();
});

const usersWithLiveMenuButton = new Set();

// ---------------- COMMANDS ----------------

bot.start(async (ctx) => {
  // Delete user's incoming /start command to keep chat clean
  await ctx.deleteMessage().catch(() => { });
  userStates.delete(ctx.from.id);

  // Set MaKo web_app menu button for this user immediately
  if (activeMiniappUrl && activeMiniappUrl.startsWith('https://')) {
    usersWithLiveMenuButton.add(`${ctx.chat.id}_${activeMiniappUrl}`);
    bot.telegram.callApi('setChatMenuButton', {
      chat_id: ctx.chat.id,
      menu_button: {
        type: 'web_app',
        text: 'MaKo',
        web_app: { url: activeMiniappUrl }
      }
    }).catch(() => {});
  }

  const user = getUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  return showScreen(ctx, getMainMenu(user));
});

// Direct Mini App Commands & Actions
bot.command(['app', 'miniapp'], async (ctx) => {
  if (activeMiniappUrl && activeMiniappUrl.startsWith('https://')) {
    return ctx.reply('✨ <b>MAKO CAMBO — 1xBet Mini App</b>\n\nសូមចុចប៊ូតុងខាងក្រោមដើម្បីបើកដំណើរការកម្មវិធី៖', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⌘ បើក App', web_app: { url: activeMiniappUrl }, style: 'primary' }]
        ]
      }
    });
  } else {
    return ctx.reply('⏳ កំពុងដំណើរការ HTTPS Server... សូមរង់ចាំ 3-5 វិនាទីរួចចុច /app ម្តងទៀត!');
  }
});

bot.action('menu_open_miniapp', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (activeMiniappUrl && activeMiniappUrl.startsWith('https://')) {
    return ctx.reply('✨ <b>MAKO CAMBO — 1xBet Mini App</b>\n\nសូមចុចប៊ូតុងខាងក្រោមដើម្បីបើកដំណើរការកម្មវិធី៖', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⌘ បើក App', web_app: { url: activeMiniappUrl }, style: 'primary' }]
        ]
      }
    });
  } else {
    return ctx.reply('⏳ កំពុងដំណើរការ HTTPS Server... សូមរង់ចាំបន្តិចរួចចុចម្តងទៀត!');
  }
});

// Admin Broadcast Command
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  userStates.set(ctx.from.id, { state: 'AWAITING_BROADCAST_MSG' });

  const totalUsers = usersDb.size;
  const text =
    `${ANIM.MEGAPHONE} <b>ផ្ញើសារទៅកាន់អ្នកប្រើប្រាស់ទាំងអស់ (BROADCAST)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 <b>ចំនួន Users ទាំងអស់:</b> <code>${totalUsers}</code> នាក់

💬 <b>សូមផ្ញើសារដែលអ្នកចង់ផ្ញើទៅកាន់ Users ទាំងអស់៖</b>
<i>(អាចផ្ញើជា Text, រូបភាព Photo, ឬ វីដេអូ Video ដោយមាន Caption ឬគ្មានក៏បាន)</i>

${ANIM.BULB} <i>ប្រព័ន្ធនឹងធ្វើការផ្ញើសារនោះទៅកាន់ Users ទាំងអស់ដែលបាន Start Bot នេះ!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  return showScreen(ctx, { text, reply_markup });
});

// Admin Broadcast Callback
bot.action('admin_broadcast_menu', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery('⚠️ អ្នកមិនមានសិទ្ធិប្រើប្រាស់មុខងារនេះទេ!', { show_alert: true }).catch(() => { });
    return;
  }

  userStates.set(ctx.from.id, { state: 'AWAITING_BROADCAST_MSG' });

  const totalUsers = usersDb.size;
  const text =
    `${ANIM.MEGAPHONE} <b>ផ្ញើសារទៅកាន់អ្នកប្រើប្រាស់ទាំងអស់ (BROADCAST)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 <b>ចំនួន Users ទាំងអស់:</b> <code>${totalUsers}</code> នាក់

💬 <b>សូមផ្ញើសារដែលអ្នកចង់ផ្ញើទៅកាន់ Users ទាំងអស់៖</b>
<i>(អាចផ្ញើជា Text, រូបភាព Photo, ឬ វីដេអូ Video ដោយមាន Caption ឬគ្មានក៏បាន)</i>

${ANIM.BULB} <i>ប្រព័ន្ធនឹងធ្វើការផ្ញើសារនោះទៅកាន់ Users ទាំងអស់ដែលបាន Start Bot នេះ!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  await ctx.answerCbQuery().catch(() => { });
  return showScreen(ctx, { text, reply_markup });
});

// Quick Helper: /id command to get any Chat/Group ID easily
bot.command('id', async (ctx) => {
  const chatInfo =
    `${ANIM.ID} <b>Chat ID:</b> <code>${ctx.chat.id}</code>
${ANIM.PIN} <b>Title:</b> <code>${ctx.chat.title || ctx.chat.first_name || 'Private'}</code>
${ANIM.ID} <b>Type:</b> <code>${ctx.chat.type}</code>`;

  console.log(`\n📢 [ID Command] Chat ID: ${ctx.chat.id} | Title: "${ctx.chat.title || 'Private'}" | Type: ${ctx.chat.type}`);
  return ctx.replyWithHTML(chatInfo);
});

// Detect when Bot is added to a new Group or Channel
bot.on('my_chat_member', (ctx) => {
  console.log(`\n📢 [Bot Added to Group/Channel]`);
  console.log(`👉 Title: "${ctx.chat.title}"`);
  console.log(`👉 EXACT CHAT ID: ${ctx.chat.id}`);
  console.log(`👉 Status: ${ctx.myChatMember.new_chat_member.status}\n`);
});

// ---------------- CALLBACK QUERIES ----------------

bot.action('verify_joined', async (ctx) => {
  const userId = ctx.from.id;
  const user = getUser(userId, ctx.from.first_name);

  try {
    const check = await checkMembership(ctx, userId);

    if (check.isMember) {
      await ctx.answerCbQuery('🎉 សូមអរគុណ! អ្នកបានចូលរួម Channel ជោគជ័យហើយ!', { show_alert: true }).catch(() => { });
      return showScreen(ctx, getMainMenu(user));
    } else {
      await ctx.answerCbQuery(
        '⚠️ សូមអភ័យទោស! អ្នកមិនទាន់បានចុចចូលរួម Channel ទេ!\n\nសូមចុចប៊ូតុង "ចូលរួម Channel" ជាមុនសិន រួចចុចផ្ទៀងផ្ទាត់ម្តងទៀត។',
        { show_alert: true }
      ).catch(() => { });
    }
  } catch (err) {
    await ctx.answerCbQuery('⚠️ មានបញ្ហាក្នុងការផ្ទៀងផ្ទាត់! សូមព្យាយាមម្តងទៀត។').catch(() => { });
  }
});

bot.action('menu_refresh', async (ctx) => {
  const user = getUser(ctx.from.id, ctx.from.first_name);
  await ctx.answerCbQuery('🔄 បានធ្វើបច្ចុប្បន្នភាពរួចរាល់!').catch(() => { });
  return showScreen(ctx, getMainMenu(user));
});

bot.action('menu_profile', async (ctx) => {
  userStates.delete(ctx.from.id);
  const user = getUser(ctx.from.id, ctx.from.first_name);
  const text =
    `${ANIM.CROWN} <b>ព័ត៌មានគណនីរបស់អ្នក (YOUR PROFILE)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${ANIM.CROWN} <b>ឈ្មោះ:</b> ${user.name}
${ANIM.ID} <b>User ID:</b> <code>${user.id}</code>
${ANIM.MONEY} <b>សមតុល្យ:</b> <code>$${user.balance.toFixed(2)} USD</code>
${ANIM.CART} <b>ចំនួនទិញសរុប:</b> <code>${user.orders.length} ដង</code>
${ANIM.CALENDAR} <b>កាលបរិច្ឆេទចូលរួម:</b> <code>${user.joinedAt}</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'បញ្ចូលលុយឥឡូវនេះ',
          callback_data: 'menu_topup',
          icon_custom_emoji_id: BTN_ICONS.MONEY,
          style: 'success'
        }
      ],
      [
        {
          text: 'ត្រឡប់ក្រោយ (Back)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'primary'
        }
      ]
    ]
  };

  await ctx.answerCbQuery().catch(() => { });
  return showScreen(ctx, { text, reply_markup });
});

bot.action('menu_buy', async (ctx) => {
  userStates.delete(ctx.from.id);
  const text =
    `${ANIM.CART} <b>បញ្ជីសេវាកម្ម និងគណនី (PRODUCT CATALOG)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>សូមជ្រើសរើសប្រភេទគណនីដែលអ្នកចង់ទិញ៖</i>

${ANIM.LIGHTNING} <b>1. គណនី Telegram (Old / New)</b>
${ANIM.FIRE} <b>2. គណនី Game (Free Fire / PUBG)</b>
${ANIM.SPARKLES} <b>3. គណនី Social (TikTok, Facebook, IG)</b>
${ANIM.DIAMOND} <b>4. គណនី Gmail Verified</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${ANIM.CHECK} <i>រាល់ការទិញទទួលបានការធានា 100%!</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: 'Telegram ($1.50)', callback_data: 'buy_item_tg', icon_custom_emoji_id: BTN_ICONS.PLANE, style: 'primary' },
        { text: 'Game ($3.00)', callback_data: 'buy_item_game', icon_custom_emoji_id: BTN_ICONS.GAME, style: 'primary' }
      ],
      [
        { text: 'Social Media ($2.00)', callback_data: 'buy_item_social', icon_custom_emoji_id: BTN_ICONS.DIAMOND, style: 'primary' },
        { text: 'Gmail Verified ($0.50)', callback_data: 'buy_item_gmail', icon_custom_emoji_id: BTN_ICONS.CHECK, style: 'primary' }
      ],
      [
        { text: 'ត្រឡប់ក្រោយ (Back)', callback_data: 'back_main', icon_custom_emoji_id: BTN_ICONS.BACK, style: 'danger' }
      ]
    ]
  };

  await ctx.answerCbQuery().catch(() => { });
  return showScreen(ctx, { text, reply_markup });
});

// ---------------- HOW TO DEPOSIT & WITHDRAW GUIDES ----------------

bot.action('guide_topup', async (ctx) => {
  await ctx.answerCbQuery().catch(() => { });
  const text =
    `${ANIM.BULB} <b>របៀបដាក់ប្រាក់ (How to Top-Up)</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${ANIM.SPARKLES} <i>ខាងក្រោមនេះជាការណែនាំអំពីរបៀបដាក់ប្រាក់ (Add Funds) ចូលក្នុងគណនី 1xBet របស់អ្នក៖</i>

${ANIM.CHECK} <b>ជំហានងាយៗ៖</b>
1️⃣ ចុចប៊ូតុង <b>«ដាក់ប្រាក់»</b> នៅលើ Menu ចម្បង
2️⃣ បញ្ចូលលេខ <b>ID 1xBet</b> របស់អ្នក
3️⃣ ជ្រើសរើសចំនួនទឹកប្រាក់ជាដុល្លារ (USD)
4️⃣ ស្កេនទូទាត់តាម <b>KHQR</b> (Bakong, ABA...)
5️⃣ ប្រព័ន្ធនឹងបញ្ជូនទៅ Admin ភ្លាមៗដើម្បី Add Funds ចូលគណនី 1xBet របស់អ្នក!`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'ដាក់ប្រាក់ឥឡូវនេះ',
          callback_data: 'menu_topup',
          icon_custom_emoji_id: BTN_ICONS.DEPOSIT,
          style: 'success'
        }
      ],
      [
        {
          text: 'ត្រឡប់ក្រោយ (Back)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'primary'
        }
      ]
    ]
  };

  const video = getAddFundsVideo();
  return showScreen(ctx, { text, reply_markup, video, videoKey: 'addfunds' });
});

bot.action('guide_withdraw', async (ctx) => {
  const userId = ctx.from.id;
  userStates.delete(userId);
  await ctx.answerCbQuery().catch(() => { });

  const chatId = ctx.chat.id;
  const oldMsgId = userActiveMsgs.get(chatId) || ctx.callbackQuery?.message?.message_id;
  if (oldMsgId) {
    await ctx.telegram.deleteMessage(chatId, oldMsgId).catch(() => { });
  }

  const text =
    `សូមចុច Username នេះឆាតទៅ Admin ដើម្បីដកប្រាក់ ( @ma_ko168 )\n` +
    `<tg-emoji emoji-id="5269720500468201056">👈</tg-emoji>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'ឆាតទៅកាន់ Admin (@ma_ko168)',
          url: 'https://t.me/ma_ko168',
          icon_custom_emoji_id: BTN_ICONS.CHAT,
          style: 'primary'
        }
      ],
      [
        {
          text: 'ត្រឡប់ក្រោយ (Back)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'danger'
        }
      ]
    ]
  };

  const sent = await ctx.replyWithHTML(text, { reply_markup });
  userActiveMsgs.set(chatId, sent.message_id);
});

// ---------------- 1XBET WITHDRAWAL (DIRECT ADMIN CONTACT) ----------------

bot.action('menu_withdraw', async (ctx) => {
  const userId = ctx.from.id;
  userStates.delete(userId);
  await ctx.answerCbQuery().catch(() => { });

  const chatId = ctx.chat.id;
  const oldMsgId = userActiveMsgs.get(chatId) || ctx.callbackQuery?.message?.message_id;
  if (oldMsgId) {
    await ctx.telegram.deleteMessage(chatId, oldMsgId).catch(() => { });
  }

  const text =
    `សូមចុច Username នេះឆាតទៅ Admin ដើម្បីដកប្រាក់ ( @ma_ko168 )\n` +
    `<tg-emoji emoji-id="5269720500468201056">👈</tg-emoji>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'ឆាតទៅកាន់ Admin (@ma_ko168)',
          url: 'https://t.me/ma_ko168',
          icon_custom_emoji_id: BTN_ICONS.CHAT,
          style: 'primary'
        }
      ],
      [
        {
          text: 'ត្រឡប់ក្រោយ (Back)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'danger'
        }
      ]
    ]
  };

  const sent = await ctx.replyWithHTML(text, { reply_markup });
  userActiveMsgs.set(chatId, sent.message_id);
});

// ---------------- 1XBET TOP-UP (STEP 1 OF 2: INPUT 1XBET ID) ----------------

bot.action('menu_topup', async (ctx) => {
  const userId = ctx.from.id;
  userStates.set(userId, { state: 'AWAITING_1XBET_ID' });

  const text =
    `${ANIM.CARD} <b>1xBet Top-Up | Step 1 of 3</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.ONEXBET} <b>សូមផ្ញើលេខ ID 1xBet របស់អ្នក:</b>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'បោះបង់',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  await ctx.answerCbQuery().catch(() => { });
  return showScreen(ctx, { text, reply_markup });
});

// Step 2: Select USD Amount (Exclusively USD)
function showUsdAmountScreen(ctx, oneXBetId, playerName = null) {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);
  const resolvedPlayerName = playerName || userState?.playerName || null;
  userStates.set(userId, { state: 'TOPUP_SELECT_AMOUNT_USD', oneXBetId, playerName: resolvedPlayerName });
  const user = getUser(userId, ctx.from.first_name);
  const displayName = resolvedPlayerName || user.name || ctx.from.first_name || 'VIP Member';

  const text =
    `${ANIM.SUCCESS} <b>រកឃើញគណនី (ID FOUND)!</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.DIAMOND} <b>ID 1xBet:</b> <code>${oneXBetId}</code>\n` +
    `${ANIM.USER} <b>ឈ្មោះ:</b> <b>${displayName}</b>\n` +
    `${ANIM.MONEY} <b>រូបិយប័ណ្ណ:</b> <b>USD ($)</b>\n` +
    `${ANIM.MONEY} <b>សមតុល្យ:</b> <b>$${user.balance.toFixed(2)} USD</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.DOWN} <b>សូមជ្រើសរើសចំនួនទឹកប្រាក់ (USD):</b>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '🧪 $0.02 (Test)', callback_data: `sel_bank_0.02_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' },
        { text: '$3.00', callback_data: `sel_bank_3_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' },
        { text: '$5.00', callback_data: `sel_bank_5_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' }
      ],
      [
        { text: '$10.00', callback_data: `sel_bank_10_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' },
        { text: '$20.00', callback_data: `sel_bank_20_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' },
        { text: '$50.00', callback_data: `sel_bank_50_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' }
      ],
      [
        { text: '$100.00', callback_data: `sel_bank_100_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.MONEY, style: 'primary' }
      ],
      [
        {
          text: 'បញ្ចូលចំនួនផ្ទាល់ខ្លួន (Custom USD)',
          callback_data: `topup_custom_USD_${oneXBetId}`,
          icon_custom_emoji_id: BTN_ICONS.EDIT,
          style: 'success'
        }
      ],
      [
        {
          text: 'ត្រឡប់ក្រោយ (Back)',
          callback_data: 'menu_topup',
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'primary'
        },
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  return showScreen(ctx, { text, reply_markup });
}

function showCurrencySelectScreen(ctx, oneXBetId) {
  return showUsdAmountScreen(ctx, oneXBetId);
}

function showRielAmountScreen(ctx, oneXBetId) {
  return showUsdAmountScreen(ctx, oneXBetId);
}

// Custom USD Amount Prompt
bot.action(/topup_custom_USD_(.+)/, async (ctx) => {
  const oneXBetId = ctx.match[1];
  const userId = ctx.from.id;
  userStates.set(userId, { state: 'AWAITING_CUSTOM_AMOUNT_USD', oneXBetId });

  const text =
    `${ANIM.CARD} <b>បញ្ចូលប្រាក់ផ្ទាល់ខ្លួន (USD)</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.ONEXBET} <b>ID 1xBet:</b> <code>${oneXBetId}</code>\n` +
    `${ANIM.SPARKLES} <i>សូមបញ្ចូលទឹកប្រាក់ក្នុងប្រអប់សារ:</i>\n\n` +
    `${ANIM.BULB} <b>ឧទាហរណ៍:</b> <code>0.02</code> , <code>3</code> , <code>3.50</code> ,\n` +
    `<i>(Min: $0.02 - Max: $10000)</i>\n` +
    `━━━━━━━━━━━━━━━`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: 'ត្រឡប់ក្រោយ',
          callback_data: `sel_curr_USD_${oneXBetId}`,
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'primary'
        },
        {
          text: 'បោះបង់',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  await ctx.answerCbQuery().catch(() => { });
  return showScreen(ctx, { text, reply_markup });
});

bot.action(/topup_custom_KHR_(.+)/, async (ctx) => {
  const oneXBetId = ctx.match[1];
  return showUsdAmountScreen(ctx, oneXBetId);
});

// Step 3: Choose Bank (Bakong or ABA)
function showBankSelectScreen(ctx, amount, currency = 'USD', oneXBetId, explicitAmount = null) {
  const displayAmount = `$${parseFloat(explicitAmount || amount).toFixed(2)} USD`;
  const amountParam = explicitAmount !== null ? explicitAmount : amount;

  const text =
    `${ANIM.CARD} <b>1xBet Top-Up | Step 3 of 3</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.DIAMOND} <b>ID 1xBet:</b> <code>${oneXBetId}</code>\n` +
    `${ANIM.MONEY} <b>ចំនួនទឹកប្រាក់:</b> <b>${displayAmount}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.BAKONG} <b>Bakong : ${ADMIN_BAKONG_NAME}</b>\n` +
    `${ANIM.ABA} <b>ABA : ${ADMIN_ABA_NAME}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.DOWN} <b>សូមជ្រើសរើសធនាគារទូទាត់៖</b>`;

  const reply_markup = {
    inline_keyboard: [
      [
        {
          text: `Bakong (${ADMIN_BAKONG_NAME})`,
          callback_data: `pay_bank_bakong_${amountParam}_USD_${oneXBetId}`,
          icon_custom_emoji_id: BTN_ICONS.BAKONG,
          style: 'primary'
        }
      ],
      [
        {
          text: `ABA Bank (${ADMIN_ABA_NAME})`,
          callback_data: `pay_bank_aba_${amountParam}_USD_${oneXBetId}`,
          icon_custom_emoji_id: BTN_ICONS.ABA,
          style: 'success'
        }
      ],
      [
        {
          text: 'ត្រឡប់ក្រោយ (Back)',
          callback_data: `sel_curr_USD_${oneXBetId}`,
          icon_custom_emoji_id: BTN_ICONS.BACK,
          style: 'primary'
        },
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  return showScreen(ctx, { text, reply_markup });
}

// Helper: Generate KHQR Card, Auto-Check & Notify Admin Group
async function initiateKhqrPayment(ctx, usdAmount, oneXBetId = 'N/A', currency = 'USD', explicitAmount = null, bank = 'aba') {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const username = ctx.from.username ? `@${ctx.from.username}` : 'គ្មាន';

  let finalUsdAmount = explicitAmount !== null && explicitAmount !== undefined && !isNaN(Number(explicitAmount))
    ? parseFloat(Number(explicitAmount).toFixed(2))
    : parseFloat(Number(usdAmount).toFixed(2));
  let chargeAmount = finalUsdAmount;

  // 1. Show animated loading state
  const isAba = String(bank).toLowerCase() === 'aba';
  const bankName = isAba ? 'ABA Bank' : 'Bakong';
  const loadingText = `${ANIM.REFRESH} <b>កំពុងដំណើរការបង្កើតកាត KHQR (${bankName}) ចំនួន ${finalUsdAmount.toFixed(2)} USD...</b>\n<i>${ANIM.HOURGLASS} សូមរង់ចាំមួយភ្លែត...</i>`;

  await showScreen(ctx, {
    text: loadingText,
    reply_markup: { inline_keyboard: [] }
  });

  try {
    const data = await generateKHQR(chargeAmount, 'USD', bank);

    if (!data.success || !data.qrString) {
      throw new Error(data.error || 'Failed to generate KHQR');
    }

    const tranId = data.tranId;
    const expiresAt = Date.now() + 3 * 60 * 1000; // 3 minutes expiry (180 seconds)

    const computedDeepLink = data.deepLink || (data.qrString ? `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(data.qrString)}` : null);
    const computedAndroidIntent = data.androidIntent || (data.qrString ? `intent://ababank.com?type=payway&qrcode=${encodeURIComponent(data.qrString)}#Intent;scheme=abamobilebank;package=com.ababank.mobile;end` : null);

    if (isAba) {
      abaDeeplinks.set(tranId, {
        tranId,
        amount: data.amountFormatted || finalUsdAmount.toFixed(2),
        qrString: data.qrString,
        deepLink: computedDeepLink,
        androidIntent: computedAndroidIntent,
        expiresAt: Date.now() + 15 * 60 * 1000
      });
    }

    // 2. Render authentic Bank KHQR Card: Bakong -> MAKO CAMBO, ABA -> MAKO H.T
    const displayMerchant = isAba ? ADMIN_ABA_NAME : ADMIN_BAKONG_NAME;

    const cardBuffer = await createKhqrCard({
      merchantName: displayMerchant,
      amount: data.amountFormatted || finalUsdAmount.toFixed(2),
      currency: 'USD',
      qrString: data.qrString,
      bank: isAba ? 'aba' : 'bakong'
    });

    const amountCaption = `<b>$${data.amountFormatted || finalUsdAmount.toFixed(2)} USD</b>`;
    const bankHeader = isAba ? 'ABA PayWay' : 'Bakong KHQR';
    const scanInstruction = isAba
      ? 'ស្កេនជាមួយ ABA Mobile ឬគ្រប់ធនាគារទាំងអស់!'
      : 'ស្កេនជាមួយ Bakong App, ABA Mobile ឬគ្រប់ធនាគារទាំងអស់!';

    const bankLine = isAba
      ? `${ANIM.ABA} <b>ABA : ${ADMIN_ABA_NAME}</b>`
      : `${ANIM.BAKONG} <b>Bakong : ${ADMIN_BAKONG_NAME}</b>`;

    const liveBaseUrl = (process.env.MINIAPP_URL && !process.env.MINIAPP_URL.includes('trycloudflare') && !process.env.MINIAPP_URL.includes('localhost'))
      ? process.env.MINIAPP_URL
      : 'https://makopay-bot.onrender.com';
    const payAbaUrl = `${liveBaseUrl}/pay-aba?tranId=${encodeURIComponent(tranId)}&amount=${encodeURIComponent(data.amountFormatted || finalUsdAmount.toFixed(2))}&qr=${encodeURIComponent(data.qrString)}`;

    const caption =
      `${ANIM.MONEY} <b>វិក្កយបត្របង់ប្រាក់ ${bankHeader}</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `${bankLine}\n` +
      `${ANIM.DIAMOND} <b>ហាង:</b> <code>${displayMerchant}</code>\n` +
      `${ANIM.CARD} <b>ធនាគារ:</b> <code>${bankName}</code>\n` +
      `${ANIM.ONEXBET} <b>ID 1xBet:</b> <code>${oneXBetId}</code>\n` +
      `${ANIM.MONEY} <b>ចំនួនទឹកប្រាក់:</b> ${amountCaption}\n` +
      `${ANIM.ID} <b>លេខវិក្កយបត្រ:</b> <code>${tranId}</code>\n` +
      `${ANIM.HOURGLASS} <b>សុពលភាព:</b> <code>3 នាទី</code>\n` +
      `━━━━━━━━━━━━━━━\n` +
      (isAba ? `📲 <a href="${payAbaUrl}">👉 <b>ចុចទីនេះដើម្បីបើក ABA Mobile ផ្ទាល់</b></a>\n━━━━━━━━━━━━━━━\n` : '') +
      `${ANIM.PHONE} <i>${scanInstruction}</i>\n` +
      `${ANIM.REFRESH} <i>ប្រព័ន្ធត្រួតពិនិត្យស្វ័យប្រវត្តិ (Auto 24/7)...</i>`;

    const buttons = [];
    if (isAba) {
      buttons.push([
        {
          text: 'បើកបង់ប្រាក់ក្នុង ABA Mobile',
          url: payAbaUrl,
          icon_custom_emoji_id: BTN_ICONS.ABA,
          style: 'primary'
        }
      ]);
    }
    buttons.push([
      {
        text: 'បោះបង់ (Cancel)',
        callback_data: `cancel_pay_${tranId}`,
        icon_custom_emoji_id: BTN_ICONS.CANCEL,
        style: 'danger'
      }
    ]);

    const reply_markup = { inline_keyboard: buttons };

    // Send the high-resolution styled KHQR Card image
    const sentMsg = await showScreen(ctx, {
      text: caption,
      photo: { source: cardBuffer },
      reply_markup
    });

    // 3. Auto-Check Background Poller (Runs sequentially, avoiding overlapping checks)
    let isPolling = false;
    const pollInterval = setInterval(async () => {
      if (isPolling) return;
      if (processedTopupTrans.has(tranId)) {
        clearInterval(pollInterval);
        return;
      }
      const tx = pendingTxs.get(tranId);
      if (!tx) {
        clearInterval(pollInterval);
        return;
      }

      if (checkingTopupTxs.has(tranId)) return;
      checkingTopupTxs.add(tranId);
      isPolling = true;

      try {
        const result = await checkPaymentStatus(tx.tranId, tx.md5);
        if (result.status === 'PAID' || result.paid === true || result.status === 'SUCCESS') {
          clearInterval(pollInterval);
          clearTimeout(tx.timerId);
          await processSuccessfulTopup(tranId);
        }
      } catch (e) {
        // Ignore background polling glitches
      } finally {
        checkingTopupTxs.delete(tranId);
        isPolling = false;
      }
    }, 2500);

    // 4. Set 3-Minute Live Expiry Timer
    const timerId = setTimeout(async () => {
      const tx = pendingTxs.get(tranId);
      if (!tx) return;

      clearInterval(tx.pollInterval);
      pendingTxs.delete(tranId);

      const expiredAmt = `$${tx.usdAmount.toFixed(2)} USD`;

      const expiredCaption =
        `${ANIM.WARN} <b>វិក្កយបត្រផុតកំណត់ (EXPIRED)</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${ANIM.LOCK} <i>កូដ KHQR មានសុពលភាព 3 នាទី</i>\n` +
        `${ANIM.ONEXBET} <b>ID 1xBet:</b> <code>${oneXBetId}</code>\n` +
        `${ANIM.MONEY} <b>ចំនួនទឹកប្រាក់:</b> <b>${expiredAmt}</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `<i>សូមបង្កើតវិក្កយបត្រថ្មីដើម្បីបន្ត!</i>`;

      const expiredMarkup = {
        inline_keyboard: [
          [
            {
              text: 'បង្កើតថ្មី (Generate New)',
              callback_data: 'menu_topup',
              icon_custom_emoji_id: BTN_ICONS.REFRESH,
              style: 'success'
            }
          ],
          [
            {
              text: 'ទៅកាន់ Menu ចម្បង',
              callback_data: 'back_main',
              icon_custom_emoji_id: BTN_ICONS.BACK,
              style: 'primary'
            }
          ]
        ]
      };

      try {
        await ctx.telegram.deleteMessage(chatId, sentMsg.message_id).catch(() => { });
        const sentExpired = await ctx.telegram.sendMessage(chatId, expiredCaption, {
          parse_mode: 'HTML',
          reply_markup: expiredMarkup
        });
        if (sentExpired?.message_id) {
          userActiveMsgs.set(chatId, sentExpired.message_id);
        }
      } catch (e) { }
    }, 3 * 60 * 1000);

    // Save pending transaction with timer, pollInterval, bank and currency details
    pendingTxs.set(tranId, {
      userId,
      chatId,
      usdAmount: finalUsdAmount,
      currency: 'USD',
      chargeAmount,
      oneXBetId,
      username,
      bank: String(bank).toLowerCase(),
      md5: data.md5,
      tranId,
      token: data.token || null,
      clientId: data.clientId || null,
      stateRequestTime: data.stateRequestTime || null,
      deviceId: data.deviceId || null,
      qrString: data.qrString,
      deepLink: computedDeepLink,
      androidIntent: computedAndroidIntent,
      msgId: sentMsg.message_id,
      timerId,
      pollInterval,
      expiresAt
    });

  } catch (err) {
    console.error("Error creating KHQR:", err);
    await showScreen(ctx, {
      text: `${ANIM.WARN} <b>មានបញ្ហាក្នុងការបង្កើតកូដ KHQR:</b> <code>${err.message}</code>\nសូមទាក់ទង Admin: ${SUPPORT_LINK}`,
      reply_markup: {
        inline_keyboard: [[{ text: 'ត្រឡប់ក្រោយ (Back)', callback_data: 'menu_topup', icon_custom_emoji_id: BTN_ICONS.BACK, style: 'danger' }]]
      }
    });
  }
}

// Currency Selection Callback (Always USD)
bot.action(/sel_curr_(USD|KHR)_(.+)/, async (ctx) => {
  const oneXBetId = ctx.match[2];
  await ctx.answerCbQuery().catch(() => { });
  return showUsdAmountScreen(ctx, oneXBetId);
});

// Back from Amount Selection
bot.action(/back_to_curr_(.+)/, async (ctx) => {
  const oneXBetId = ctx.match[1];
  await ctx.answerCbQuery().catch(() => { });
  return showUsdAmountScreen(ctx, oneXBetId);
});

// User selected preset amount -> Show Bank Choice Screen
bot.action(/sel_bank_([0-9.]+)_([A-Z]+)_(.+)/, async (ctx) => {
  const rawAmount = parseFloat(ctx.match[1]);
  const oneXBetId = ctx.match[3];
  await ctx.answerCbQuery().catch(() => { });
  return showBankSelectScreen(ctx, rawAmount, 'USD', oneXBetId, rawAmount);
});

// Also support legacy gen_qr_
bot.action(/gen_qr_([0-9.]+)_([A-Z]+)_(.+)/, async (ctx) => {
  const rawAmount = parseFloat(ctx.match[1]);
  const oneXBetId = ctx.match[3];
  await ctx.answerCbQuery().catch(() => { });
  return showBankSelectScreen(ctx, rawAmount, 'USD', oneXBetId, rawAmount);
});

// User chose Bank (Bakong or ABA) -> Generate KHQR
bot.action(/pay_bank_(bakong|aba)_([0-9.]+)_([A-Z]+)_(.+)/, async (ctx) => {
  const bank = ctx.match[1];
  const rawAmount = parseFloat(ctx.match[2]);
  const oneXBetId = ctx.match[4];
  await ctx.answerCbQuery().catch(() => { });
  return initiateKhqrPayment(ctx, rawAmount, oneXBetId, 'USD', rawAmount, bank);
});

// Swap Payment Bank (Bakong <-> ABA)
bot.action(/swap_bank_([^_]+)_(bakong|aba)/, async (ctx) => {
  const oldTranId = ctx.match[1];
  const targetBank = ctx.match[2];
  const tx = pendingTxs.get(oldTranId);

  if (!tx) {
    await ctx.answerCbQuery('⚠️ វិក្កយបត្រនេះបានផុតកំណត់ ឬមិនត្រឹមត្រូវទេ!', { show_alert: true }).catch(() => { });
    return;
  }

  if (tx.pollInterval) clearInterval(tx.pollInterval);
  if (tx.timerId) clearTimeout(tx.timerId);
  pendingTxs.delete(oldTranId);

  const bankName = targetBank === 'bakong' ? 'Bakong' : 'ABA';
  await ctx.answerCbQuery(`កំពុងប្តូរទៅជា ${bankName}...`).catch(() => { });

  await initiateKhqrPayment(ctx, tx.usdAmount, tx.oneXBetId, 'USD', tx.usdAmount, targetBank);
});

// Check Live Payment Callback
bot.action(/verify_pay_(.+)/, async (ctx) => {
  const tranId = ctx.match[1];
  const tx = pendingTxs.get(tranId);

  if (!tx) {
    await ctx.answerCbQuery('⚠️ វិក្កយបត្រនេះបានផុតកំណត់ ឬមិនត្រឹមត្រូវទេ!', { show_alert: true }).catch(() => { });
    return;
  }

  await ctx.answerCbQuery('🔄 កំពុងត្រួតពិនិត្យប្រព័ន្ធធនាគារ...').catch(() => { });

  try {
    const result = await checkPaymentStatus(tx.tranId, tx.md5);

    if (result.status === 'PAID' || result.paid === true || result.status === 'SUCCESS') {
      await processSuccessfulTopup(tranId);
      await ctx.answerCbQuery('✅ ការទូទាត់ប្រាក់ជោគជ័យ!').catch(() => { });
      return;
    } else {
      const remainingSec = Math.max(0, Math.round((tx.expiresAt - Date.now()) / 1000));
      await ctx.answerCbQuery(
        `⏳ មិនទាន់ទទួលបានការទូទាត់ទេ!\n(នៅសល់ពេល: ${remainingSec} វិនាទី)\n\nសូមស្កេនទូទាត់តាម Banking App រួចចុចពិនិត្យម្តងទៀត។`,
        { show_alert: true }
      ).catch(() => { });
    }
  } catch (err) {
    console.error("Error checking payment:", err);
    await ctx.answerCbQuery(`⚠️ បរាជ័យក្នុងការត្រួតពិនិត្យ: ${err.message}`, { show_alert: true }).catch(() => { });
  }
});

// Cancel Payment
bot.action(/cancel_pay_(.+)/, async (ctx) => {
  const tranId = ctx.match[1];
  const tx = pendingTxs.get(tranId);
  if (tx) {
    if (tx.pollInterval) clearInterval(tx.pollInterval);
    clearTimeout(tx.timerId);
    pendingTxs.delete(tranId);
  }
  await ctx.answerCbQuery('បានបោះបង់វិក្កយបត្រនេះរួចរាល់!').catch(() => { });
  const user = getUser(ctx.from.id, ctx.from.first_name);
  return showScreen(ctx, getMainMenu(user));
});

// ---------------- ADMIN ACTION HANDLERS (TOP-UP & WITHDRAWAL) ----------------

// 1. Admin Top-Up: DONE
bot.action(/adm_td_(.+)/, async (ctx) => {
  const tranId = ctx.match[1];
  const adminName = ctx.from?.first_name || 'Admin';

  // Instant response to Telegram to prevent loading spinner hang
  await ctx.answerCbQuery('✅ បានកត់ត្រាការបញ្ចូលប្រាក់ជោគជ័យ!').catch(() => { });

  const rawMsgText = ctx.callbackQuery?.message?.text || ctx.callbackQuery?.message?.caption || '';
  let req = topupRequests.get(tranId);

  // If memory was cleared on server restart, auto-recover transaction details from the message text!
  if (!req) {
    req = parseTopupFromMessage(rawMsgText, tranId);
  }

  // Non-blocking background dispatch
  dispatchMobcashDeposit({
    oneXBetId: req.oneXBetId,
    amount: req.amount,
    tranId
  }).catch(err => console.warn('[MobCash Async Dispatch Warning]:', err.message));

  // 1. Remove admin message from Admin Top-Up group as requested
  await ctx.deleteMessage().catch(() => { });

  // 2. Store & update in persistent history
  const histItem = transactionsHistory.find(h => h.id === tranId);
  if (histItem) {
    histItem.completedBy = adminName;
    histItem.status = 'COMPLETED';
    histItem.updatedAt = Date.now();
    saveHistoryToDisk();
  } else {
    addHistoryRecord({
      id: tranId,
      type: 'topup',
      userId: req.userId,
      chatId: req.chatId || req.userId,
      name: req.name,
      username: req.username,
      oneXBetId: req.oneXBetId,
      amount: req.amount,
      bank: req.bank,
      status: 'COMPLETED',
      completedBy: adminName,
      date: req.date || new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
    });
  }
  updateHistoryStatus(tranId, 'COMPLETED');

  // 3. Send back to User: Remove old waiting message and show new completion message (Image 3 format)
  const targetChatId = req.chatId || req.userId;
  if (targetChatId) {
    const checkEmoji = '<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji>';
    const diamondEmoji = '<tg-emoji emoji-id="5427168083074628963">💎</tg-emoji>';
    const moneyEmoji = '<tg-emoji emoji-id="5409048419211682843">💵</tg-emoji>';
    const receiptEmoji = '<tg-emoji emoji-id="5444856076954520455">🧾</tg-emoji>';

    const userSuccessText =
      `${checkEmoji} <b>ការបញ្ចូលទឹកប្រាក់ទទួលបានជោគជ័យ!</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `${diamondEmoji} <b>ID 1xBet:</b> <code>${req.oneXBetId}</code>\n` +
      `${moneyEmoji} <b>ចំនួនទឹកប្រាក់:</b> <b>+$${Number(req.amount).toFixed(2)} USD</b>\n` +
      `${receiptEmoji} <b>លេខវិក្កយបត្រ:</b> <code>${tranId}</code>\n\n` +
      `${checkEmoji} <i><b>សូមពិនិត្យមើលក្នុងគណនី 1xBet របស់អ្នក។</b></i>\n` +
      `<i><b>អរគុណសម្រាប់ការប្រើប្រាស់សេវាកម្ម!</b></i>`;

    const waitMsgId = req.userWaitMsgId || userActiveMsgs.get(targetChatId);
    if (waitMsgId) {
      await bot.telegram.deleteMessage(targetChatId, waitMsgId).catch(() => { });
    }

    const sent = await bot.telegram.sendMessage(targetChatId, userSuccessText, {
      parse_mode: 'HTML'
    }).catch(err => console.error('Failed to send success to user:', err.message));

    if (sent?.message_id) {
      userActiveMsgs.set(targetChatId, sent.message_id);
    }
  }

  topupRequests.delete(tranId);
  saveTopupRequestsToDisk();
});

// 2. Admin Top-Up: CANCEL
bot.action(/adm_tc_(.+)/, async (ctx) => {
  const tranId = ctx.match[1];

  await ctx.answerCbQuery('❌ បានបដិសេធសំណើ!').catch(() => { });

  const rawMsgText = ctx.callbackQuery?.message?.text || ctx.callbackQuery?.message?.caption || '';
  let req = topupRequests.get(tranId);

  // If memory was cleared on server restart, auto-recover from message text!
  if (!req) {
    req = parseTopupFromMessage(rawMsgText, tranId);
  }

  // Remove admin message
  await ctx.deleteMessage().catch(() => { });

  // Update persistent history
  updateHistoryStatus(tranId, 'REJECTED');

  // Replace waiting message for User in-place with cancel message
  const targetChatId = req.chatId || req.userId;
  if (targetChatId) {
    const userText =
      `${ANIM.WARN} <b>ការបញ្ចូលទឹកប្រាក់មិនជោគជ័យ (TOPUP FAILED)</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${ANIM.ONEXBET} <b>ID 1xBet:</b> <code>${req.oneXBetId}</code>\n` +
      `${ANIM.MONEY} <b>ចំនួនទឹកប្រាក់:</b> <b>$${Number(req.amount).toFixed(2)} USD</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${ANIM.CROSS} <i>ប្រព័ន្ធមិនអាចស្វែងរកលេខគណនី ID 1xBet របស់អ្នកឃើញទេ! សូមពិនិត្យលេខសម្គាល់គណនីរបស់អ្នកឡើងវិញ ឬទាក់ទង Admin៖</i>\n` +
      `${ANIM.CHAT} Support: ${SUPPORT_USERNAME} (${SUPPORT_LINK})`;

    const userMarkup = {
      inline_keyboard: [
        [
          {
            text: 'ទាក់ទង Support',
            url: SUPPORT_LINK,
            icon_custom_emoji_id: BTN_ICONS.CHAT,
            style: 'success'
          },
          {
            text: 'ទៅកាន់ Menu ចម្បង',
            callback_data: 'back_main',
            icon_custom_emoji_id: BTN_ICONS.BACK,
            style: 'danger'
          }
        ]
      ]
    };

    const waitMsgId = req.userWaitMsgId || userActiveMsgs.get(targetChatId);
    let edited = false;
    if (waitMsgId) {
      try {
        await bot.telegram.editMessageText(targetChatId, waitMsgId, null, userText, {
          parse_mode: 'HTML',
          reply_markup: userMarkup
        });
        edited = true;
      } catch (e) {
        try {
          await bot.telegram.deleteMessage(targetChatId, waitMsgId).catch(() => { });
        } catch (_) { }
      }
    }

    if (!edited) {
      const sent = await bot.telegram.sendMessage(targetChatId, userText, {
        parse_mode: 'HTML',
        reply_markup: userMarkup
      }).catch(() => { });
      if (sent?.message_id) {
        userActiveMsgs.set(targetChatId, sent.message_id);
      }
    }
  }

  topupRequests.delete(tranId);
  saveTopupRequestsToDisk();
});

// 3. Admin Withdrawal: DONE
bot.action(/adm_wd_(.+)/, async (ctx) => {
  const withdrawId = ctx.match[1];

  await ctx.answerCbQuery('✅ បានកត់ត្រាការផ្ទេរប្រាក់ជោគជ័យ!').catch(() => { });

  const rawMsgText = ctx.callbackQuery?.message?.caption || ctx.callbackQuery?.message?.text || '';
  let req = withdrawRequests.get(withdrawId);

  // Auto-recover from message caption if memory was reset
  if (!req) {
    req = parseWithdrawFromMessage(rawMsgText, withdrawId);
  }

  // Remove admin message
  await ctx.deleteMessage().catch(() => { });

  // Update persistent history
  updateHistoryStatus(withdrawId, 'COMPLETED');

  // Replace waiting message for User in-place with success message (no stacking / no new message)
  const targetChatId = req.chatId || req.userId;
  if (targetChatId) {
    const userText =
      `${ANIM.PARTY} <b>ការដកប្រាក់ជោគជ័យ (SUCCESSFUL)!</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${req.code}</code>\n` +
      `${req.bank ? `${ANIM.CARD} <b>ធនាគារ:</b> <b>${req.bank}</b>\n` : ''}` +
      `${req.accountName ? `👤 <b>ឈ្មោះគណនី:</b> <b>${req.accountName}</b>\n` : ''}` +
      `${ANIM.RECEIPT} <b>Withdraw ID:</b> <b>${withdrawId}</b>\n` +
      `━━━━━━━━━━━━━━━\n` +
      `${ANIM.SUCCESS} <i>Admin បានផ្ទេរប្រាក់ជូនរួចរាល់ហើយ!</i>`;

    const userMarkup = {
      inline_keyboard: [
        [
          {
            text: 'ទៅកាន់ Menu ចម្បង',
            callback_data: 'back_main',
            icon_custom_emoji_id: BTN_ICONS.DIAMOND,
            style: 'primary'
          }
        ]
      ]
    };

    const waitMsgId = req.userWaitMsgId || userActiveMsgs.get(targetChatId);
    let edited = false;
    if (waitMsgId) {
      try {
        await bot.telegram.editMessageText(targetChatId, waitMsgId, null, userText, {
          parse_mode: 'HTML',
          reply_markup: userMarkup
        });
        edited = true;
      } catch (e) {
        try {
          await bot.telegram.deleteMessage(targetChatId, waitMsgId).catch(() => { });
        } catch (_) { }
      }
    }

    if (!edited) {
      const sent = await bot.telegram.sendMessage(targetChatId, userText, {
        parse_mode: 'HTML',
        reply_markup: userMarkup
      }).catch(() => { });
      if (sent?.message_id) {
        userActiveMsgs.set(targetChatId, sent.message_id);
      }
    }
  }

  withdrawRequests.delete(withdrawId);
  saveWithdrawRequestsToDisk();
});

// 4. Admin Withdrawal: CANCEL
bot.action(/adm_wc_(.+)/, async (ctx) => {
  const withdrawId = ctx.match[1];

  await ctx.answerCbQuery('❌ បានបដិសេធសំណើដកប្រាក់!').catch(() => { });

  const rawMsgText = ctx.callbackQuery?.message?.caption || ctx.callbackQuery?.message?.text || '';
  let req = withdrawRequests.get(withdrawId);

  // Auto-recover from message caption if memory was reset
  if (!req) {
    req = parseWithdrawFromMessage(rawMsgText, withdrawId);
  }

  // Remove admin message
  await ctx.deleteMessage().catch(() => { });

  // Update persistent history
  updateHistoryStatus(withdrawId, 'REJECTED');

  // Replace waiting message for User in-place with cancel message
  const targetChatId = req.chatId || req.userId;
  if (targetChatId) {
    const userText =
      `${ANIM.WARN} <b>ការដកប្រាក់មិនជោគជ័យ (WITHDRAWAL FAILED)</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${ANIM.SHIELD} <b>Code:</b> <code>${req.code}</code>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `${ANIM.CROSS} <i>លេខកូដមិនត្រឹមត្រូវ ឬរកមិនឃើញក្នុងប្រព័ន្ធ 1xBet ទេ! សូមពិនិត្យលេខកូដ និងផ្ញើ QR Code ម្តងទៀត ឬទាក់ទងមកកាន់ Admin៖</i>\n` +
      `${ANIM.CHAT} Support: ${SUPPORT_USERNAME} (${SUPPORT_LINK})`;

    const userMarkup = {
      inline_keyboard: [
        [
          {
            text: 'ទាក់ទង Support',
            url: SUPPORT_LINK,
            icon_custom_emoji_id: BTN_ICONS.CHAT,
            style: 'success'
          },
          {
            text: 'ទៅកាន់ Menu ចម្បង',
            callback_data: 'back_main',
            icon_custom_emoji_id: BTN_ICONS.CANCEL,
            style: 'danger'
          }
        ]
      ]
    };

    const waitMsgId = req.userWaitMsgId || userActiveMsgs.get(targetChatId);
    let edited = false;
    if (waitMsgId) {
      try {
        await bot.telegram.editMessageText(targetChatId, waitMsgId, null, userText, {
          parse_mode: 'HTML',
          reply_markup: userMarkup
        });
        edited = true;
      } catch (e) {
        try {
          await bot.telegram.deleteMessage(targetChatId, waitMsgId).catch(() => { });
        } catch (_) { }
      }
    }

    if (!edited) {
      const sent = await bot.telegram.sendMessage(targetChatId, userText, {
        parse_mode: 'HTML',
        reply_markup: userMarkup
      }).catch(() => { });
      if (sent?.message_id) {
        userActiveMsgs.set(targetChatId, sent.message_id);
      }
    }
  }

  withdrawRequests.delete(withdrawId);
  saveWithdrawRequestsToDisk();
});

// ---------------- WITHDRAWAL USER VERIFICATION ACTIONS ----------------

// User Confirms Withdrawal -> Send to Admin
bot.action('wd_confirm_submit', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);
  if (!userState || !userState.withdrawCode || !userState.photoFileId) {
    await ctx.answerCbQuery('⚠️ មិនមានទិន្នន័យផ្ទៀងផ្ទាត់ទេ សូមចាប់ផ្តើមម្តងទៀត!').catch(() => { });
    const user = getUser(userId, ctx.from.first_name);
    return showScreen(ctx, getMainMenu(user));
  }

  await ctx.answerCbQuery('✅ កំពុងបញ្ជូនសំណើទៅកាន់ Admin...').catch(() => { });

  const code = userState.withdrawCode;
  const photoFileId = userState.photoFileId;
  const khqr = userState.khqr || {};
  userStates.delete(userId);

  const withdrawId = 'WD' + Date.now().toString().slice(-6);
  const user = getUser(userId, ctx.from.first_name);
  const username = ctx.from.username ? `@${ctx.from.username}` : 'គ្មាន';

  // 1. Tell user: request submitted
  const userText =
    `${ANIM.HOURGLASS} <b>សំណើដកប្រាក់ត្រូវបានបញ្ជូន!</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${code}</code>\n` +
    `${ANIM.CARD} <b>ធនាគារ:</b> <b>${khqr.bankName || 'KHQR'}</b>\n` +
    `${khqr.accountName ? `👤 <b>ឈ្មោះគណនី:</b> <b>${khqr.accountName}</b>\n` : ''}` +
    `${khqr.accountId ? `💳 <b>គណនី/សម្គាល់:</b> <b>${khqr.accountId}</b>\n` : ''}` +
    `${ANIM.RECEIPT} <b>Withdraw ID:</b> <b>${withdrawId}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${ANIM.HOURGLASS} <i>សូមរង់ចាំបន្តិច Admin កំពុងពិនិត្យ...</i>`;

  const userMarkup = {
    inline_keyboard: [
      [
        {
          text: 'ទៅកាន់ Menu ចម្បង',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.DIAMOND,
          style: 'primary'
        }
      ]
    ]
  };

  const sentWait = await showScreen(ctx, { text: userText, reply_markup: userMarkup });
  const waitMsgId = sentWait?.message_id || userActiveMsgs.get(ctx.chat.id);

  // Store withdrawal request
  withdrawRequests.set(withdrawId, {
    withdrawId,
    userId,
    chatId: ctx.chat.id,
    userWaitMsgId: waitMsgId,
    name: user.name,
    username,
    code,
    bank: khqr.bankName || 'KHQR',
    accountName: khqr.accountName || '',
    accountId: khqr.accountId || '',
    photoFileId,
    date: new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
  });
  saveWithdrawRequestsToDisk();

  addHistoryRecord({
    id: withdrawId,
    type: 'withdraw',
    userId,
    chatId: ctx.chat.id,
    name: user.name,
    username,
    code,
    bank: khqr.bankName || 'KHQR',
    accountName: khqr.accountName || '',
    accountId: khqr.accountId || '',
    status: 'PENDING'
  });

  // 2. Send photo with details & action buttons to Admin Withdraw Group
  const adminCaption =
    `${ANIM.SIREN} <b>សំណើដកប្រាក់ថ្មី ( New )</b>\n\n` +
    `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${code}</code>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `${ANIM.CROWN} <b>អតិថិជន:</b> <a href="tg://user?id=${userId}">${user.name}</a> (${username})\n` +
    `${ANIM.ID} <b>Telegram ID:</b> <code>${userId}</code>\n` +
    `${ANIM.RECEIPT} <b>Withdraw ID:</b> <code>${withdrawId}</code>\n` +
    `${ANIM.CARD} <b>ធនាគារ:</b> <code>${khqr.bankName || 'Bakong KHQR'}</code>\n` +
    `${khqr.accountName ? `👤 <b>ឈ្មោះគណនី:</b> <code>${khqr.accountName}</code>\n` : ''}` +
    `${khqr.accountId ? `💳 <b>គណនី/សម្គាល់:</b> <code>${khqr.accountId}</code>\n` : ''}` +
    `${ANIM.CALENDAR} <b>កាលបរិច្ឆេទ:</b> <code>${new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })}</code>`;

  const adminMarkup = {
    inline_keyboard: [
      [
        {
          text: 'ផ្ទេររួចរាល់ (Done)',
          callback_data: `adm_wd_${withdrawId}`,
          icon_custom_emoji_id: BTN_ICONS.SUCCESS,
          style: 'success'
        },
        {
          text: 'បដិសេធ (Cancel)',
          callback_data: `adm_wc_${withdrawId}`,
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  if (ADMIN_WITHDRAW_GROUP_ID) {
    try {
      await ctx.telegram.sendPhoto(ADMIN_WITHDRAW_GROUP_ID, photoFileId, {
        caption: adminCaption,
        parse_mode: 'HTML',
        reply_markup: adminMarkup
      });
    } catch (err) {
      console.error(`❌ Failed to send withdraw request to admin group (${ADMIN_WITHDRAW_GROUP_ID}):`, err.message);
    }
  }
});

// User wants to edit 4-digit code
bot.action('wd_edit_code', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);
  await ctx.answerCbQuery().catch(() => { });
  if (!userState) {
    const user = getUser(userId, ctx.from.first_name);
    return showScreen(ctx, getMainMenu(user));
  }

  userState.state = 'AWAITING_WITHDRAW_EDIT_CODE';
  userStates.set(userId, userState);

  const text =
    `${ANIM.SHIELD} <b>កែប្រែ Code 4 ខ្ទង់ (Edit 4-Digit Code)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `លេខកូដបច្ចុប្បន្ន: <code>${userState.withdrawCode || 'N/A'}</code>\n\n` +
    `✍️ <b>សូមផ្ញើលេខកូដសម្ងាត់ថ្មី (New 4-Digit Code):</b>`;

  const reply_markup = {
    inline_keyboard: [
      [
        ...(userState.khqr ? [
          {
            text: 'ត្រឡប់ក្រោយ (Back)',
            callback_data: 'wd_back_verify',
            icon_custom_emoji_id: BTN_ICONS.BACK,
            style: 'primary'
          }
        ] : []),
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  return showScreen(ctx, { text, reply_markup });
});

// User wants to edit / re-upload QR Code
bot.action('wd_edit_qr', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);
  await ctx.answerCbQuery().catch(() => { });
  if (!userState) {
    const user = getUser(userId, ctx.from.first_name);
    return showScreen(ctx, getMainMenu(user));
  }

  userState.state = 'AWAITING_WITHDRAW_EDIT_QR';
  userStates.set(userId, userState);

  const currentBank = userState.khqr?.bankName || 'KHQR';
  const text =
    `${ANIM.QR} <b>ប្តូររូបភាព QR Code (Change QR Code)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${ANIM.CARD} ធនាគារបច្ចុប្បន្ន: <code>${currentBank}</code>\n\n` +
    `${ANIM.QR} <b>សូមផ្ញើរូបភាព QR Code ធនាគារថ្មីរបស់អ្នក (Bakong / ABA / Wing / ACLEDA):</b>`;

  const reply_markup = {
    inline_keyboard: [
      [
        ...(userState.khqr ? [
          {
            text: 'ត្រឡប់ក្រោយ (Back)',
            callback_data: 'wd_back_verify',
            icon_custom_emoji_id: BTN_ICONS.BACK,
            style: 'primary'
          }
        ] : []),
        {
          text: 'បោះបង់ (Cancel)',
          callback_data: 'back_main',
          icon_custom_emoji_id: BTN_ICONS.CANCEL,
          style: 'danger'
        }
      ]
    ]
  };

  return showScreen(ctx, { text, reply_markup });
});

// User returns back to verification screen
bot.action('wd_back_verify', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);
  await ctx.answerCbQuery().catch(() => { });
  if (!userState || !userState.withdrawCode) {
    const user = getUser(userId, ctx.from.first_name);
    return showScreen(ctx, getMainMenu(user));
  }

  userState.state = 'AWAITING_WITHDRAW_VERIFY';
  userStates.set(userId, userState);
  const screen = getWithdrawVerifyScreen(userState);
  return showScreen(ctx, screen);
});


// Interactive Transactions History (Top-up & Withdraw)
bot.action('menu_history', async (ctx) => {
  userStates.delete(ctx.from.id);
  await ctx.answerCbQuery().catch(() => { });
  const screen = getHistoryScreen(ctx.from.id, 'today', isAdmin(ctx.from.id));
  return showScreen(ctx, screen);
});

bot.action('hist_today', async (ctx) => {
  await ctx.answerCbQuery('📅 ប្រវត្តិថ្ងៃនេះ (Today)').catch(() => { });
  const screen = getHistoryScreen(ctx.from.id, 'today', isAdmin(ctx.from.id));
  return showScreen(ctx, screen);
});

bot.action('hist_ytd', async (ctx) => {
  await ctx.answerCbQuery('📆 ប្រវត្តិម្សិលមិញ (YTD)').catch(() => { });
  const screen = getHistoryScreen(ctx.from.id, 'ytd', isAdmin(ctx.from.id));
  return showScreen(ctx, screen);
});

bot.action('hist_all', async (ctx) => {
  await ctx.answerCbQuery('📋 ប្រវត្តិទាំងអស់ (All)').catch(() => { });
  const screen = getHistoryScreen(ctx.from.id, 'all', isAdmin(ctx.from.id));
  return showScreen(ctx, screen);
});

// Buying item handler
bot.action(/buy_item_(.+)/, async (ctx) => {
  const user = getUser(ctx.from.id, ctx.from.first_name);
  await ctx.answerCbQuery(
    `⚠️ សមតុល្យរបស់អ្នកមិនគ្រប់គ្រាន់ទេ ($${user.balance.toFixed(2)})!\nសូមបញ្ចូលលុយជាមុនសិន។`,
    { show_alert: true }
  ).catch(() => { });
});

// Back to Main Menu
bot.action('back_main', async (ctx) => {
  userStates.delete(ctx.from.id);
  const user = getUser(ctx.from.id, ctx.from.first_name);
  await ctx.answerCbQuery().catch(() => { });
  return showScreen(ctx, getMainMenu(user));
});

// ---------------- USER INPUT HANDLERS (TEXT & PHOTO) ----------------

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);

  // Delete user's incoming photo message to keep chat neat
  await ctx.deleteMessage().catch(() => { });

  if (userState?.state === 'AWAITING_WITHDRAW_QR' || userState?.state === 'AWAITING_WITHDRAW_EDIT_QR' || userState?.state === 'AWAITING_WITHDRAW_VERIFY') {
    userStates.delete(userId);
    const text =
      `សូមចុច Username នេះឆាតទៅ Admin ដើម្បីដកប្រាក់ ( @ma_ko168 )\n` +
      `<tg-emoji emoji-id="5269720500468201056">👈</tg-emoji>`;
    const reply_markup = {
      inline_keyboard: [
        [
          { text: 'ឆាតទៅកាន់ Admin (@ma_ko168)', url: 'https://t.me/ma_ko168', icon_custom_emoji_id: BTN_ICONS.CHAT, style: 'primary' }
        ],
        [
          { text: 'ត្រឡប់ក្រោយ (Back)', callback_data: 'back_main', icon_custom_emoji_id: BTN_ICONS.BACK, style: 'danger' }
        ]
      ]
    };
    return showScreen(ctx, { text, reply_markup });
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userState = userStates.get(userId);

  // Clean up user's typed message immediately so chat stays neat
  await ctx.deleteMessage().catch(() => { });

  // 1. Step 1 of Top-up: User enters 1xBet ID -> Check ID in App
  if (userState?.state === 'AWAITING_1XBET_ID' || userState?.state === 'AWAITING_MELBET_ID') {
    const oneXBetId = ctx.message.text.trim();
    if (!oneXBetId) return;

    const checkResult = await verifyOneXBetId(oneXBetId, ctx.from);
    if (!checkResult.found) {
      const errText =
        `${ANIM.CROSS} <b>រកមិនឃើញ ID នេះក្នុង App ទេ (ID NOT FOUND IN APP)</b>
━━━━━━━━━━━━━━━━━━
${ANIM.DIAMOND} <b>ID 1xBet ដែលបានបញ្ចូល:</b> <code>${oneXBetId}</code>
${ANIM.WARN} <i>ប្រព័ន្ធពិនិត្យមិនឃើញលេខសម្គាល់ ID នេះនៅក្នុងកម្មវិធី 1xBet ឡើយ។</i>

${ANIM.BULB} <b>សូមចំណាំ៖</b>
• លេខ ID 1xBet ត្រូវតែជាលេខសុទ្ធពី 6 ដល់ 11 ខ្ទង់ (ឧទាហរណ៍៖ <code>1407771169</code>)
• សូមពិនិត្យមើល ID នៅក្នុងកម្មវិធី 1xBet របស់អ្នកឡើងវិញ
━━━━━━━━━━━━━━━━━━`;

      const reply_markup = {
        inline_keyboard: [
          [
            { text: 'ព្យាយាមម្តងទៀត (Try Again)', callback_data: 'menu_topup', icon_custom_emoji_id: BTN_ICONS.SPARKLES, style: 'primary' },
            { text: 'ទៅកាន់ Menu ចម្បង', callback_data: 'back_main', icon_custom_emoji_id: BTN_ICONS.BACK, style: 'danger' }
          ]
        ]
      };
      return showScreen(ctx, { text: errText, reply_markup });
    }

    // ID Found in App! Show Amount Screen with player name confirmed
    return showUsdAmountScreen(ctx, oneXBetId, checkResult.playerName);
  }

  // 2. Custom USD Amount for Top-up -> Show Bank Choice Screen
  if (userState?.state === 'AWAITING_CUSTOM_AMOUNT_USD' || userState?.state === 'AWAITING_CUSTOM_AMOUNT' || userState?.state === 'AWAITING_CUSTOM_AMOUNT_KHR') {
    const rawInput = ctx.message.text.trim().replace(/[^0-9.]/g, '');
    const usdAmount = Math.round(parseFloat(rawInput) * 100) / 100;
    const oneXBetId = userState?.oneXBetId || 'N/A';

    if (isNaN(usdAmount) || usdAmount < 0.02 || usdAmount > 10000) {
      const errText =
        `${ANIM.WARN} <b>ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវទេ!</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `${ANIM.DIAMOND} <b>ID 1xBet:</b> <code>${oneXBetId}</code>\n` +
        `${ANIM.CROSS} <b>សូមបញ្ចូលទឹកប្រាក់ (Min: $0.02 - Max: $10000)!</b>\n` +
        `${ANIM.BULB} <b>ឧទាហរណ៍:</b> <code>0.02</code> , <code>3</code> , <code>3.50</code> ,\n` +
        `━━━━━━━━━━━━━━━`;
      const reply_markup = {
        inline_keyboard: [
          [
            { text: 'ត្រឡប់ក្រោយ', callback_data: `sel_curr_USD_${oneXBetId}`, icon_custom_emoji_id: BTN_ICONS.BACK, style: 'primary' },
            { text: 'បោះបង់', callback_data: 'back_main', icon_custom_emoji_id: BTN_ICONS.CANCEL, style: 'danger' }
          ]
        ]
      };
      return showScreen(ctx, { text: errText, reply_markup });
    }

    userStates.delete(userId);
    return showBankSelectScreen(ctx, usdAmount, 'USD', oneXBetId, usdAmount);
  }

  // 3. User in withdrawal state -> direct to Admin
  if (userState?.state === 'AWAITING_WITHDRAW_CODE' || userState?.state === 'AWAITING_WITHDRAW_EDIT_CODE') {
    userStates.delete(userId);
    const text =
      `សូមចុច Username នេះឆាតទៅ Admin ដើម្បីដកប្រាក់ ( @ma_ko168 )\n` +
      `<tg-emoji emoji-id="5269720500468201056">👈</tg-emoji>`;

    const reply_markup = {
      inline_keyboard: [
        [
          {
            text: 'ឆាតទៅកាន់ Admin (@ma_ko168)',
            url: 'https://t.me/ma_ko168',
            icon_custom_emoji_id: BTN_ICONS.CHAT,
            style: 'primary'
          }
        ],
        [
          {
            text: 'ត្រឡប់ក្រោយ (Back)',
            callback_data: 'back_main',
            icon_custom_emoji_id: BTN_ICONS.BACK,
            style: 'danger'
          }
        ]
      ]
    };

    return showScreen(ctx, { text, reply_markup });
  }

  // If user sends random text outside any flow, refresh the main menu cleanly
  const user = getUser(userId, ctx.from.first_name);
  return showScreen(ctx, getMainMenu(user));
});

// ---------------- START BOT ----------------
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 Starting Telegram Bot with AUTHENTIC KHQR CARD & 1-MIN EXPIRY...');
console.log(`📡 Bot Username: @MakoPay_bot`);
console.log(`📢 Target Channel: ${CHANNEL_USERNAME} (${CHANNEL_ID})`);
console.log(`📥 ដាក់ប្រាក់ (Top-Up) Group: ${ADMIN_TOPUP_GROUP_ID}`);
console.log(`📤 ដកប្រាក់ (Withdrawal) Group: ${ADMIN_WITHDRAW_GROUP_ID}`);
console.log(`💳 Payment Gateway: ${PAYLINK_BASE_URL}`);
console.log(`🔑 Merchant: ${STORE_NAME} (${BAKONG_ACCOUNT})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// HTTP Server for Render Deployment, Web Health-Check & React Telegram Mini App
const http = require('http');
const urlModule = require('url');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const MINIAPP_DIST = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  parsedUrl.query = Object.fromEntries(parsedUrl.searchParams);
  const pathname = parsedUrl.pathname;

  // 1. Health-check endpoint
  if (pathname === '/health' || pathname === '/api/health') {
    return sendJson(res, 200, { status: 'ok', service: '1xbet-telegram-bot', uptime: Math.floor(process.uptime()) });
  }

  // 1.1 Direct ABA Mobile App Auto-Redirect (Android & iOS - Bypasses PayWay Merchant Web Profile & Webpage)
  if (pathname === '/pay-aba' || pathname === '/pay/aba') {
    const tranId = parsedUrl.query.tranId || parsedUrl.query.id || '';
    let qrString = parsedUrl.query.qr || '';

    if (!qrString && tranId) {
      const saved = pendingTxs.get(tranId) || abaDeeplinks.get(tranId);
      if (saved) {
        qrString = saved.qrString || '';
      }
    }

    const fallbackUrl = (process.env.ABA_PAYWAY_URL || 'https://link.payway.com.kh/a3550666t').trim();
    const deepLink = qrString
      ? `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(qrString)}`
      : fallbackUrl;
    const androidIntent = qrString
      ? `intent://ababank.com?type=payway&qrcode=${encodeURIComponent(qrString)}#Intent;scheme=abamobilebank;package=com.ababank.mobile;end`
      : deepLink;

    const userAgent = req.headers['user-agent'] || '';
    const isAndroid = /Android/i.test(userAgent);
    const targetUrl = isAndroid ? androidIntent : deepLink;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });

    const html = `<!DOCTYPE html>
<html lang="km">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>បើក ABA Mobile...</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080d1a;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: linear-gradient(180deg, #101b33 0%, #0d1629 100%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 32px 24px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    .aba-badge {
      width: 72px;
      height: 72px;
      border-radius: 20px;
      background: linear-gradient(135deg, #004d66 0%, #007399 50%, #00a3cc 100%);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 1px;
      box-shadow: 0 10px 25px rgba(0, 115, 153, 0.4);
    }
    h1 {
      font-size: 19px;
      font-weight: 800;
      margin-bottom: 8px;
      color: #ffffff;
    }
    p {
      font-size: 13.5px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .btn-main {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 16px;
      border-radius: 14px;
      background: linear-gradient(135deg, #005F82 0%, #0084b3 100%);
      color: #ffffff;
      text-decoration: none;
      font-size: 16px;
      font-weight: 800;
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(0, 95, 130, 0.4);
      margin-bottom: 12px;
    }
    .btn-sub {
      display: block;
      width: 100%;
      padding: 13px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      color: #94a3b8;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2.5px solid rgba(255, 255, 255, 0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="aba-badge">ABA</div>
    <h1>កំពុងបើក ABA Mobile...</h1>
    <p>ប្រសិនបើកម្មវិធី ABA មិនបើកដោយស្វ័យប្រវត្តិ សូមចុចប៊ូតុងធំខាងក្រោម</p>
    
    <a id="btnLaunchAba" href="${targetUrl}" class="btn-main">
      <div class="spinner"></div>
      <span>បើក ABA Mobile ភ្លាមៗ</span>
    </a>
    
    <a href="${fallbackUrl}" class="btn-sub">
      បង់តាមទំព័រ PayWay Web ជំនួសវិញ
    </a>
  </div>

  <script>
    (function() {
      var target = ${JSON.stringify(targetUrl)};
      try {
        window.location.href = target;
      } catch (e) {}
    })();
  </script>
</body>
</html>`;

    return res.end(html);
  }

  // 2. Mini App API: Check 1xBet ID in App
  if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/miniapp/check-id') {
    try {
      let oneXBetId = '';
      let name = '';
      let username = '';
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        oneXBetId = String(body.oneXBetId || body.id || '').trim();
        name = body.name || '';
        username = body.username || '';
      } else {
        oneXBetId = String(parsedUrl.query.id || parsedUrl.query.oneXBetId || '').trim();
        name = parsedUrl.query.name || '';
        username = parsedUrl.query.username || '';
      }

      const check = await verifyOneXBetId(oneXBetId, { first_name: name, username });
      return sendJson(res, 200, {
        success: true,
        found: check.found,
        playerName: check.playerName || null,
        message: check.found ? 'ID found' : 'ID not found in app',
        reason: check.reason || null
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 3. Mini App API: Create Top-Up KHQR
  if (req.method === 'POST' && pathname === '/api/miniapp/topup/create-qr') {
    try {
      const body = await parseJsonBody(req);
      const amount = parseFloat(body.amount);
      const bank = String(body.bank || 'aba').toLowerCase();
      const oneXBetId = String(body.oneXBetId || 'N/A').trim();
      const userId = body.userId || 6810457857;
      const username = body.username || 'User';
      const name = body.name || 'Member';

      if (isNaN(amount) || amount < 0.02 || amount > 10000) {
        return sendJson(res, 400, { success: false, error: 'ចំនួនទឹកប្រាក់ត្រូវតែចាប់ពី $0.02 ឡើងទៅ (អតិបរមា: $10,000)' });
      }

      const data = await generateKHQR(amount, 'USD', bank);
      if (!data.success || !data.qrString) {
        return sendJson(res, 500, { success: false, error: data.error || 'Failed to generate KHQR' });
      }

      const tranId = data.tranId;
      const isAba = String(bank).toLowerCase() === 'aba';
      const displayMerchant = isAba ? (ADMIN_ABA_NAME || 'MAKO by H.T') : ADMIN_BAKONG_NAME;

      const computedDeepLink = data.deepLink || (data.qrString ? `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(data.qrString)}` : null);
      const computedAndroidIntent = data.androidIntent || (data.qrString ? `intent://ababank.com?type=payway&qrcode=${encodeURIComponent(data.qrString)}#Intent;scheme=abamobilebank;package=com.ababank.mobile;end` : null);

      if (isAba) {
        abaDeeplinks.set(tranId, {
          tranId,
          amount: data.amountFormatted || amount.toFixed(2),
          qrString: data.qrString,
          deepLink: computedDeepLink,
          androidIntent: computedAndroidIntent,
          expiresAt: Date.now() + 15 * 60 * 1000
        });
      }

      // Save pending transaction with 3-minute live poller & expiry
      pendingTxs.set(tranId, {
        userId,
        chatId: userId,
        usdAmount: amount,
        currency: 'USD',
        chargeAmount: amount,
        oneXBetId,
        username,
        name,
        bank,
        md5: data.md5,
        tranId,
        token: data.token || null,
        clientId: data.clientId || null,
        stateRequestTime: data.stateRequestTime || null,
        deviceId: data.deviceId || null,
        qrString: data.qrString,
        deepLink: computedDeepLink,
        androidIntent: computedAndroidIntent,
        expiresAt: Date.now() + 3 * 60 * 1000
      });

      let qrDataUrl = null;
      try {
        const QRCode = require('qrcode');
        qrDataUrl = await QRCode.toDataURL(data.qrString, { margin: 1, width: 300 });
      } catch (_) {}

      return sendJson(res, 200, {
        success: true,
        tranId,
        qrString: data.qrString,
        qrDataUrl,
        amount: data.amountFormatted || amount.toFixed(2),
        currency: 'USD',
        bank: data.bank || bank.toUpperCase(),
        deepLink: computedDeepLink,
        androidIntent: computedAndroidIntent,
        merchantName: displayMerchant
      });
    } catch (err) {
      console.error('API Error /create-qr:', err);
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 3. Mini App API: Check Top-Up Status
  if (req.method === 'GET' && pathname === '/api/miniapp/topup/check-status') {
    try {
      const tranId = parsedUrl.query.tranId;
      if (!tranId) {
        return sendJson(res, 400, { success: false, error: 'tranId is required' });
      }

      // If already processed and recorded, return PAID immediately (dedup)
      if (processedTopupTrans.has(tranId)) {
        const reqTop = topupRequests.get(tranId);
        return sendJson(res, 200, {
          success: true,
          status: 'PAID',
          paid: true,
          amount: reqTop?.amount || 0,
          tranId,
          oneXBetId: reqTop?.oneXBetId || ''
        });
      }

      const tx = pendingTxs.get(tranId);
      if (!tx) {
        return sendJson(res, 200, { success: true, status: 'EXPIRED', paid: false });
      }

      // Prevent concurrent duplicate checks on same tranId
      if (checkingTopupTxs.has(tranId)) {
        return sendJson(res, 200, { success: true, status: 'PENDING', paid: false });
      }
      checkingTopupTxs.add(tranId);

      try {
        const result = await checkPaymentStatus(tx.tranId, tx.md5);
        if (result.status === 'PAID' || result.paid === true || result.status === 'SUCCESS') {
          await processSuccessfulTopup(tranId);
          return sendJson(res, 200, {
            success: true,
            status: 'PAID',
            paid: true,
            amount: tx.usdAmount,
            tranId: tx.tranId,
            oneXBetId: tx.oneXBetId
          });
        }
        return sendJson(res, 200, { success: true, status: result.status || 'PENDING', paid: false });
      } finally {
        checkingTopupTxs.delete(tranId);
      }
    } catch (err) {
      console.error('API Error /check-status:', err);
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 4. Mini App API: Submit Withdrawal
  if (req.method === 'POST' && pathname === '/api/miniapp/withdraw/submit') {
    try {
      const body = await parseJsonBody(req);
      const code = String(body.code || '').trim();
      const qrImageBase64 = body.qrImageBase64 || null;
      const userId = body.userId || 6810457857;
      const username = body.username || 'User';
      const name = body.name || 'Member';

      if (!code || code.length < 4) {
        return sendJson(res, 400, { success: false, error: 'សូមបញ្ចូលលេខកូដដកប្រាក់ 4 ខ្ទង់ពី 1xBet!' });
      }

      if (!qrImageBase64) {
        return sendJson(res, 400, { success: false, error: 'សូមបញ្ចូលរូបភាព QR Code ធនាគាររបស់អ្នក (Bakong / ABA)!' });
      }

      // Decode & check QR code from base64
      let khqr = null;
      let cleanImgBuffer = null;
      try {
        const cleanBase64 = qrImageBase64.replace(/^data:image\/\w+;base64,/, '');
        cleanImgBuffer = Buffer.from(cleanBase64, 'base64');
        const qrData = await decodeQrFromBuffer(cleanImgBuffer);
        if (qrData) {
          khqr = parseKhqrInfo(qrData);
        }
      } catch (err) {
        console.warn('MiniApp QR decode error:', err.message);
      }

      if (!khqr) {
        return sendJson(res, 400, {
          success: false,
          error: 'រកមិនឃើញ QR Code (QR Code Not Found)! សូមជ្រើសរើសរូបភាព QR Code ធនាគារ (Bakong / ABA / ACLEDA / Wing...) ឲ្យបានច្បាស់ល្អ!'
        });
      }

      const withdrawId = 'WD' + Date.now().toString().slice(-6);

      // Register withdrawal request so Admin callback actions (adm_wd_ / adm_wc_) can notify the user directly
      withdrawRequests.set(withdrawId, {
        withdrawId,
        userId,
        chatId: userId,
        name,
        username,
        code,
        bank: khqr.bankName,
        accountName: khqr.accountName,
        accountId: khqr.accountId,
        date: new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })
      });
      saveWithdrawRequestsToDisk();

      addHistoryRecord({
        id: withdrawId,
        type: 'withdraw',
        userId,
        chatId: userId,
        name,
        username,
        code,
        bank: khqr.bankName,
        accountName: khqr.accountName,
        accountId: khqr.accountId,
        status: 'PENDING'
      });

      // Send waiting message to user in Telegram chat so admin approval replaces it cleanly
      if (userId) {
        const userWaitText =
          `${ANIM.HOURGLASS} <b>សំណើដកប្រាក់ត្រូវបានបញ្ជូនរួចរាល់!</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${code}</code>\n` +
          `${ANIM.CARD} <b>ធនាគារ:</b> <code>${khqr.bankName || 'KHQR'}</code>\n` +
          `${khqr.accountName ? `👤 <b>ឈ្មោះគណនី:</b> <code>${khqr.accountName}</code>\n` : ''}` +
          `${khqr.accountId ? `💳 <b>គណនី/សម្គាល់:</b> <code>${khqr.accountId}</code>\n` : ''}` +
          `${ANIM.RECEIPT} <b>Withdraw ID:</b> <code>${withdrawId}</code>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `${ANIM.HOURGLASS} <i>សូមរង់ចាំបន្តិច Admin កំពុងពិនិត្យ និងផ្ទេរប្រាក់ជូនអ្នក...</i>`;

        const userMarkup = {
          inline_keyboard: [
            [
              {
                text: 'ទៅកាន់ Menu ចម្បង',
                callback_data: 'back_main',
                icon_custom_emoji_id: BTN_ICONS.DIAMOND,
                style: 'primary'
              }
            ]
          ]
        };

        const sentWait = await bot.telegram.sendMessage(userId, userWaitText, {
          parse_mode: 'HTML',
          reply_markup: userMarkup
        }).catch(() => { });

        if (sentWait?.message_id) {
          userActiveMsgs.set(userId, sentWait.message_id);
          const reqW = withdrawRequests.get(withdrawId);
          if (reqW) {
            reqW.userWaitMsgId = sentWait.message_id;
            saveWithdrawRequestsToDisk();
          }
        }
      }

      const adminCaption =
        `${ANIM.SIREN} <b>សំណើដកប្រាក់ថ្មី ( New )</b>\n\n` +
        `${ANIM.SHIELD} <b>Code 4 ខ្ទង់:</b> <code>${code}</code>\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `${ANIM.CROWN} <b>អតិថិជន:</b> <a href="tg://user?id=${userId}">${name}</a> (${username})\n` +
        `${ANIM.ID} <b>Telegram ID:</b> <code>${userId}</code>\n` +
        `${ANIM.RECEIPT} <b>Withdraw ID:</b> <code>${withdrawId}</code>\n` +
        `${ANIM.CARD} <b>ធនាគារ:</b> <code>${khqr.bankName || 'Bakong KHQR'}</code>\n` +
        `${khqr.accountName ? `👤 <b>ឈ្មោះគណនី:</b> <code>${khqr.accountName}</code>\n` : ''}` +
        `${khqr.accountId ? `💳 <b>គណនី/សម្គាល់:</b> <code>${khqr.accountId}</code>\n` : ''}` +
        `${ANIM.CALENDAR} <b>កាលបរិច្ឆេទ:</b> <code>${new Date().toLocaleString('km-KH', { timeZone: 'Asia/Phnom_Penh' })}</code>`;

      const adminMarkup = {
        inline_keyboard: [
          [
            {
              text: 'ផ្ទេររួចរាល់ (Done)',
              callback_data: `adm_wd_${withdrawId}`,
              icon_custom_emoji_id: BTN_ICONS.SUCCESS,
              style: 'success'
            },
            {
              text: 'បដិសេធ (Cancel)',
              callback_data: `adm_wc_${withdrawId}`,
              icon_custom_emoji_id: BTN_ICONS.CANCEL,
              style: 'danger'
            }
          ]
        ]
      };

      if (ADMIN_WITHDRAW_GROUP_ID) {
        if (cleanImgBuffer) {
          try {
            await bot.telegram.sendPhoto(ADMIN_WITHDRAW_GROUP_ID, { source: cleanImgBuffer }, {
              caption: adminCaption,
              parse_mode: 'HTML',
              reply_markup: adminMarkup
            });
          } catch (pErr) {
            console.error('Failed to send withdraw photo to admin group:', pErr.message);
            // Fallback to text message if photo buffer fails
            bot.telegram.sendMessage(ADMIN_WITHDRAW_GROUP_ID, adminCaption, {
              parse_mode: 'HTML',
              reply_markup: adminMarkup
            }).catch(() => {});
          }
        } else {
          bot.telegram.sendMessage(ADMIN_WITHDRAW_GROUP_ID, adminCaption, {
            parse_mode: 'HTML',
            reply_markup: adminMarkup
          }).catch(err => console.error('Failed to notify admin withdraw group:', err.message));
        }
      }

      return sendJson(res, 200, {
        success: true,
        tranId: withdrawId,
        code,
        withdrawId,
        bank: khqr.bankName,
        accountName: khqr.accountName,
        accountId: khqr.accountId
      });
    } catch (err) {
      console.error('API Error /withdraw/submit:', err);
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 5. Mini App API: User Info
  if (req.method === 'GET' && pathname === '/api/miniapp/user-info') {
    const userId = parsedUrl.query.userId || 6810457857;
    const name = parsedUrl.query.name || 'Member';
    const user = getUser(userId, name);
    return sendJson(res, 200, {
      id: user.id,
      name: user.name,
      balance: user.balance,
      orders: user.orders || []
    });
  }

  // 6. Static File Serving for Mini App with Gzip Acceleration & Video Range Streaming
  if (req.method === 'GET' || req.method === 'HEAD') {
    const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    let filePath = path.join(MINIAPP_DIST, cleanPath);

    // If file does not exist in public/, check root directory as well (e.g., videwellcome.mp4)
    if (!fs.existsSync(filePath)) {
      const rootCandidate = path.join(__dirname, cleanPath);
      if (fs.existsSync(rootCandidate) && !fs.statSync(rootCandidate).isDirectory()) {
        filePath = rootCandidate;
      }
    }

    // If file does not exist, fallback to index.html (SPA routing)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(MINIAPP_DIST, 'index.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isVideo = ext === '.mp4' || ext === '.mov' || ext === '.webm';

      // 6a. Video Stream with HTTP 206 Partial Content (Required for iOS / Telegram WebApp)
      if (isVideo) {
        try {
          const stat = fs.statSync(filePath);
          const fileSize = stat.size;
          const range = req.headers.range;

          if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const fileStream = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunksize,
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': '*'
            });
            return fileStream.pipe(res);
          } else {
            res.writeHead(200, {
              'Content-Length': fileSize,
              'Accept-Ranges': 'bytes',
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': '*'
            });
            return fs.createReadStream(filePath).pipe(res);
          }
        } catch (vErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          return res.end('Video Streaming Error');
        }
      }

      // 6b. Standard Static Files (HTML, JS, CSS, Images, Fonts)
      try {
        const acceptEncoding = req.headers['accept-encoding'] || '';
        const canGzip = /\bgzip\b/.test(acceptEncoding) && ['.js', '.css', '.html', '.svg', '.json'].includes(ext);
        const raw = fs.readFileSync(filePath);

        const headers = {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff'
        };

        if (req.method === 'HEAD') {
          res.writeHead(200, headers);
          return res.end();
        }

        if (canGzip) {
          headers['Content-Encoding'] = 'gzip';
          const gzipped = zlib.gzipSync(raw);
          res.writeHead(200, headers);
          return res.end(gzipped);
        } else {
          res.writeHead(200, headers);
          return res.end(raw);
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Internal Server Error');
      }
    }
  }

  // 404 Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

function freePort(port) {
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const lines = out.split('\r\n').filter(l => l.includes('LISTENING') || l.includes(`:${port}`));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== String(process.pid) && pid !== '0') {
          console.log(`🧹 Clearing old process (PID: ${pid}) from port ${port}...`);
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} busy, clearing old process and retrying...`);
    freePort(PORT);
    setTimeout(() => {
      server.listen(PORT, '0.0.0.0');
    }, 1000);
  } else {
    console.error('Server error:', err);
  }
});

freePort(PORT);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web & Telegram Mini App server running on 0.0.0.0:${PORT}`);
  initHttpsTunnel();
});

// Configure Telegram Persistent Menu Button (Bottom Left) — 'MaKo' WebApp Button
let lastRegisteredMenuUrl = null;
async function registerMenuButton(url) {
  if (!url || !url.startsWith('https://')) return;
  if (lastRegisteredMenuUrl === url) return;
  lastRegisteredMenuUrl = url;
  if (typeof usersWithLiveMenuButton !== 'undefined') {
    usersWithLiveMenuButton.clear();
  }

  try {
    await bot.telegram.callApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'MaKo',
        web_app: { url }
      }
    }).catch(() => {});

    // Update all known users in database so their menu button works immediately!
    for (const u of usersDb.values()) {
      if (u.id) {
        bot.telegram.callApi('setChatMenuButton', {
          chat_id: Number(u.id),
          menu_button: {
            type: 'web_app',
            text: 'MaKo',
            web_app: { url }
          }
        }).catch(() => {});
      }
    }

    if (ADMIN_CHAT_ID) {
      bot.telegram.callApi('setChatMenuButton', {
        chat_id: Number(ADMIN_CHAT_ID),
        menu_button: {
          type: 'web_app',
          text: 'MaKo',
          web_app: { url }
        }
      }).catch(() => {});
    }

    console.log(`✅ Telegram WebApp Menu Button 'MaKo' configured for all chats with: ${url}`);
  } catch (err) {
    console.warn('Could not set ChatMenuButton:', err.message);
  }
}

// Permanent Reliable HTTPS URL for Telegram Mini App (Render Production)
function initHttpsTunnel() {
  const configuredUrl = (process.env.MINIAPP_URL || process.env.RENDER_EXTERNAL_URL || 'https://makopay-bot.onrender.com').trim();
  activeMiniappUrl = configuredUrl;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🚀 PERMANENT TELEGRAM MINI APP URL (Render Production):`);
  console.log(`👉 ${activeMiniappUrl}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  registerMenuButton(activeMiniappUrl);
}

bot.catch((err) => {
  console.warn(`⚠️ [Telegraf Polling Warning]:`, err.message);
});

process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Unhandled Rejection Caught]:', reason?.message || reason);
  if (reason?.stack) console.warn(reason.stack);
});

process.on('uncaughtException', (err) => {
  console.warn('⚠️ [Uncaught Exception Caught]:', err.message);
  console.warn(err.stack);
  // Don't let the process die
});

process.on('exit', (code) => {
  console.warn(`🛑 [Process Exit] code=${code}`);
  console.trace('Exit trace:');
});

function launchBot() {
  console.log('🔄 Launching Telegram bot polling...');
  bot.launch({ dropPendingUpdates: true }).then(() => {
    console.log('✅ Bot is running with live KHQR Card Generator and 1-Min Auto-Expiry!');
    registerMenuButton(activeMiniappUrl);
    bot.telegram.setMyCommands([
      { command: 'start', description: 'បើកម៉ឺនុយមេ (Main Menu)' },
      { command: 'app', description: 'បើក 1xBet Mini App' },
      { command: 'miniapp', description: 'បើក 1xBet Mini App' },
      { command: 'id', description: 'មើល Telegram ID' }
    ]).catch(() => {});
  }).catch((err) => {
    console.warn('⚠️ Polling error/conflict, reconnecting in 5s:', err.message);
    // Stop any existing polling first
    try { bot.stop(); } catch(_) {}
    setTimeout(launchBot, 5000);
  });
}

launchBot();

// Graceful shutdown
process.once('SIGINT', () => {
  if (tunnelProc) try { tunnelProc.kill(); } catch(_) {}
  server.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  if (tunnelProc) try { tunnelProc.kill(); } catch(_) {}
  server.close();
  bot.stop('SIGTERM');
});
