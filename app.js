// SolChat Global – Appwrite-powered real-time global chat
// Configuration
const APPWRITE_ENDPOINT = 'https://nyc.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '690874e400173bad91d8';

// IMPORTANT: Provide your Database and Collection IDs here.
// For a one-room global chat, create a database (e.g., "solchat_global")
// and a collection (e.g., "messages") with attributes: userId(string), username(string), content(string), timestamp(datetime).
// Ensure collection permissions allow any user to read documents and users to create documents.
const DATABASE_ID = 'solchat_global';
const COLLECTION_ID = 'messages';
const PRESENCE_COLLECTION_ID = 'presence';

// App state
let currentUser = null;
let unsubscribeRealtime = null;
let unsubscribePresenceRealtime = null;
let presenceHeartbeatId = null;
let onlineRefreshIntervalId = null;
let guestTimerIntervalId = null;
let guestExpired = false;
  let hasEnteredChat = false;
  let enterChatInProgress = false;
  let sessionRecoveryInProgress = false;
  let sessionRecoveryTimer = null;
  let chartInitialized = false;
  // Controls where to route after successful login: 'landing' or 'chat'
  let loginIntent = 'landing';
  // Track last leave time to differentiate rejoin from first join
  let lastLeaveAt = null;
  // Global rate-limit cooldown timestamp (ms since epoch). When now < rateLimitUntil, actions are blocked.
  let rateLimitUntil = 0;
  // Feature flags via URL params
  let IS_DEBUG = false;
  let OFFLINE_MODE = false;
  let TV_EMBEDS = true; // default to showing TradingView embeds
  let TV_SYMBOL = 'COINBASE:SOLUSD';
  let TV_THEME = 'dark';
  try {
    const params = new URL(window.location.href).searchParams;
    IS_DEBUG = params.get('debug') === '1';
    OFFLINE_MODE = params.get('offline') === '1';
    const tvParam = params.get('tv');
    if (tvParam === '0') TV_EMBEDS = false;
    if (tvParam === '1') TV_EMBEDS = true;
    TV_SYMBOL = params.get('tvsymbol') || TV_SYMBOL;
    TV_THEME = params.get('tvtheme') || TV_THEME;
  } catch (_) {}
// Track message elements by document id for deduplication
function findMessageElById(id) {
  if (!id) return null;
  return messagesEl.querySelector(`[data-doc-id="${id}"]`);
}


// Elements
const authView = document.getElementById('authView');
const chatView = document.getElementById('chatView');
const landingView = document.getElementById('landingView');
const profileButton = document.getElementById('profileButton');
const profileMenu = document.getElementById('profileMenu');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const logoutButton = document.getElementById('logoutButton');
const loginNavButton = document.getElementById('loginNavButton');
// Mentions UI
const mentionsButton = document.getElementById('mentionsButton');
const mentionsBadge = document.getElementById('mentionsBadge');
const mentionsMenu = document.getElementById('mentionsMenu');
const mentionSuggestEl = document.getElementById('mentionSuggest');

const authForm = document.getElementById('authForm');
const resetForm = document.getElementById('resetForm');
const forgotButton = document.getElementById('forgotButton');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const resetCancelButton = document.getElementById('resetCancel');
const nameInput = document.getElementById('name');
const nameField = document.getElementById('nameField');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const switchModeButton = document.getElementById('switchMode');
const authSubmitButton = document.getElementById('authSubmit');
const guestButton = document.getElementById('guestButton');

const joinChatButton = document.getElementById('joinChatButton');
const solPriceEl = document.getElementById('solPrice');
const solPriceChangeEl = document.getElementById('solPriceChange');
const solNewsListEl = document.getElementById('solNewsList');
const solChartEl = document.getElementById('solChart');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.querySelector('#messageForm button[type="submit"]');
const usersListEl = document.getElementById('usersList');
const usersTitleEl = document.getElementById('usersTitle');
const replyBar = document.getElementById('replyBar');
const replyTextEl = document.getElementById('replyText');
const replyCancelBtn = document.getElementById('replyCancel');
const leaveChatButton = document.getElementById('leaveChatButton');
const chatFooter = document.getElementById('chatFooter');
const guestTimerEl = document.getElementById('guestTimer');
const guestCountdownEl = document.getElementById('guestCountdown');
const guestTimerBarEl = document.getElementById('guestTimerBar');
const guestUpgradeButton = document.getElementById('guestUpgradeButton');
const authBackButton = document.getElementById('authBackButton');
const resetSessionButton = document.getElementById('resetSessionButton');

const loadingEl = document.getElementById('loading');
const toastsEl = document.getElementById('toasts');

// Notification sound
let notifySound = null;
function playNotifySound() {
  try {
    if (!notifySound) {
      notifySound = new Audio('bell ring.mp3');
      notifySound.preload = 'auto';
      notifySound.volume = 0.7;
    }
    // Only attempt when tab is visible to reduce surprise
    if (document.visibilityState !== 'visible') return;
    notifySound.currentTime = 0;
    notifySound.play().catch(() => {});
  } catch (_) {}
}

// Presence cache for tooltip queries
let presenceDocs = [];

// Admin badge config
const ADMIN_EMAIL = 'mittoonsolana@gmail.com';
const ADMIN_DISPLAY_NAME = 'Mitto';
const ADMIN_BADGE_SRC = 'verification badge.png';
  let ADMIN_USER_ID = localStorage.getItem('solchat_admin_user_id') || null;
  const GUEST_USER_ID_KEY = 'solchat_guest_user_id';

function isAdmin(subject) {
  if (!subject) return false;
  const matchEmail = (val) => String(val || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const matchDisplay = (val) => String(val || '').trim().toLowerCase() === ADMIN_DISPLAY_NAME.toLowerCase();
  if (typeof subject === 'string') return matchEmail(subject);
  const email = subject?.email || subject?.userEmail || '';
  if (matchEmail(email)) return true;
  const uname = subject?.username || subject?.name || '';
  if (matchDisplay(uname)) return true;
  const uid = subject?.$id || subject?.userId || subject?.id || null;
  if (ADMIN_USER_ID && uid) return String(uid) === String(ADMIN_USER_ID);
  return false;
}

function setNameWithBadge(el, nameText, subject) {
  try {
    el.textContent = nameText || '';
    if (isAdmin(subject)) {
      const img = document.createElement('img');
      img.src = ADMIN_BADGE_SRC;
      img.alt = 'verified';
      img.className = 'badge-icon';
      // Prevent opening/saving badge via right-click or drag
      img.setAttribute('draggable', 'false');
      img.addEventListener('contextmenu', (e) => e.preventDefault());
      img.addEventListener('dragstart', (e) => e.preventDefault());
      img.addEventListener('click', (e) => e.preventDefault());
      // Tooltip interactions for founder badge
      img.addEventListener('mouseenter', () => showBadgeTooltip(img, 'He is the Admin'));
      img.addEventListener('mouseleave', hideBadgeTooltip);
      el.appendChild(img);
    }
  } catch (_) {}
}

// Lightweight tooltip for the verification badge
let badgeTooltipEl = null;
function ensureBadgeTooltip() {
  if (!badgeTooltipEl) {
    badgeTooltipEl = document.createElement('div');
    badgeTooltipEl.className = 'badge-tooltip';
 document.body.appendChild(badgeTooltipEl);
  }
}
function showBadgeTooltip(target, text) {
  try {
    ensureBadgeTooltip();
    badgeTooltipEl.textContent = text;
    const rect = target.getBoundingClientRect();
    const left = Math.round(rect.left);
    const top = Math.round(rect.bottom + 6);
    badgeTooltipEl.style.left = `${left}px`;
    badgeTooltipEl.style.top = `${top}px`;
    badgeTooltipEl.classList.add('visible');
  } catch (_) {}
}
function hideBadgeTooltip() {
  try { badgeTooltipEl?.classList.remove('visible'); } catch (_) {}
}

// Hide tooltip on scroll/resize/click outside
window.addEventListener('resize', hideBadgeTooltip);
window.addEventListener('scroll', hideBadgeTooltip, { passive: true });
document.addEventListener('click', (e) => {
  if (!e.target.classList || !e.target.classList.contains('badge-icon')) hideBadgeTooltip();
});

// Prevent right-click context menu specifically on verification badge icons
document.addEventListener('contextmenu', (e) => {
  try {
    const t = e.target;
    if (t && t.classList && t.classList.contains('badge-icon')) {
      e.preventDefault();
    }
  } catch (_) {}
});

// Mentions store
const MENTIONS_STORE_KEY = 'solchat_mentions_v1';
let mentionsList = [];
function dedupMentions(list) {
  try {
    const map = new Map();
    for (const m of list || []) {
      const key = m?.id ? `id:${m.id}` : `vf:${m.from}|${m.ts}`;
      if (!map.has(key)) {
        map.set(key, { id: m.id || null, from: m.from, ts: m.ts, text: m.text || '', read: !!m.read });
      } else {
        const existing = map.get(key);
        existing.read = existing.read && !!m.read;
        // Prefer non-empty message text if one exists
        if (!existing.text && m.text) existing.text = m.text;
        map.set(key, existing);
      }
    }
    return Array.from(map.values());
  } catch (_) {
    return list || [];
  }
}
try {
  const rawMentions = localStorage.getItem(MENTIONS_STORE_KEY);
  if (rawMentions) mentionsList = JSON.parse(rawMentions) || [];
  mentionsList = dedupMentions(mentionsList);
} catch (_) {}
function saveMentions() {
  try { mentionsList = dedupMentions(mentionsList); localStorage.setItem(MENTIONS_STORE_KEY, JSON.stringify(mentionsList.slice(-100))); } catch (_) {}
}
function updateMentionsBadge() {
  const count = mentionsList.filter(m => !m.read).length;
  if (mentionsBadge) {
    mentionsBadge.textContent = String(count);
    // Hide the badge when there are no unread items or when logged out
    mentionsBadge.hidden = count === 0 || !currentUser;
  }
  // Show the notification icon only when logged in
  try {
    if (mentionsButton) mentionsButton.style.display = currentUser ? 'inline-flex' : 'none';
  } catch (_) {}
}
function renderMentionsMenu() {
  if (!mentionsMenu) return;
  mentionsMenu.innerHTML = '';
  if (!mentionsList.length) {
    const empty = document.createElement('div');
    empty.className = 'mention__item';
    empty.textContent = 'No mentions yet';
    mentionsMenu.appendChild(empty);
    return;
  }
  const sorted = [...mentionsList].sort((a,b)=> new Date(b.ts)-new Date(a.ts)).slice(0,50);
  sorted.forEach((m, idx) => {
    const item = document.createElement('div');
    item.className = 'mention__item';
    item.setAttribute('data-doc-id', m.id || '');
    const who = document.createElement('div');
    const action = m.kind === 'reply' ? 'replied to you' : 'mentioned you';
    who.textContent = `${m.from} ${action}`;
    // Show message preview if the original message contains more than just the mention
    const myName = getDisplayName(currentUser);
    const raw = String(m.text || '').trim();
    let preview = '';
    try {
      if (raw) {
        const stripped = raw.replace(new RegExp(`(^|\\s)@${myName}(?![\\w-])`, 'g'), ' ').replace(/\s+/g,' ').trim();
        if (stripped) preview = stripped.slice(0, 200);
      }
    } catch (_) {}
    if (preview) {
      const msg = document.createElement('div');
      msg.className = 'mention__msg';
      msg.textContent = preview;
      item.appendChild(who);
      item.appendChild(msg);
    } else {
      item.appendChild(who);
    }
    const meta = document.createElement('div');
    meta.className = 'mention__meta';
    meta.textContent = new Date(m.ts).toLocaleString();
    item.appendChild(meta);
    item.addEventListener('click', () => {
      try {
        const el = findMessageElById(m.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('msg--highlight');
          setTimeout(()=> el.classList.remove('msg--highlight'), 1500);
        }
      } catch (_) {}
      m.read = true;
      saveMentions();
      updateMentionsBadge();
      mentionsMenu.classList.remove('open');
    });
    mentionsMenu.appendChild(item);
  });
  // Update scroll mask indicators after rendering
  try { updateMentionsScrollMask(); } catch (_) {}
}
// Visual scroll masks: show gradient at top/bottom when content overflows
function updateMentionsScrollMask() {
  try {
    if (!mentionsMenu) return;
    const st = mentionsMenu.scrollTop;
    const max = Math.max(0, mentionsMenu.scrollHeight - mentionsMenu.clientHeight);
    const hasTop = st > 0;
    const hasBottom = st < (max - 1);
    mentionsMenu.classList.toggle('scroll-top', hasTop);
    mentionsMenu.classList.toggle('scroll-bottom', hasBottom);
  } catch (_) {}
}
mentionsButton?.addEventListener('click', (e) => {
  e.stopPropagation();
  mentionsMenu.classList.toggle('open');
  mentionsButton?.setAttribute('aria-expanded', mentionsMenu.classList.contains('open') ? 'true' : 'false');
  if (mentionsMenu.classList.contains('open')) {
    positionMentionsMenu();
    try { updateMentionsScrollMask(); } catch (_) {}
    // Mark all notifications as read when the user opens the menu
    let changed = false;
    for (const m of mentionsList) {
      if (!m.read) { m.read = true; changed = true; }
    }
    if (changed) {
      saveMentions();
      updateMentionsBadge();
    }
  }
});
// Bind scroll listener once
try { mentionsMenu?.addEventListener('scroll', () => updateMentionsScrollMask(), { passive: true }); } catch (_) {}
document.addEventListener('click', (e) => {
  if (!mentionsMenu) return;
  const within = mentionsMenu.contains(e.target) || mentionsButton?.contains(e.target);
  if (!within) mentionsMenu.classList.remove('open');
});
updateMentionsBadge();
renderMentionsMenu();

// ===== @mention autocomplete =====
let activeUsers = [];
let mentionIndex = -1; // keyboard selection index

function getMentionToken(value, cursor) {
  try {
    const upto = value.slice(0, cursor);
    const atIdx = Math.max(upto.lastIndexOf('@'), -1);
    if (atIdx === -1) return null;
    // Must start at beginning or after whitespace
    if (atIdx > 0 && /\S/.test(upto[atIdx - 1])) return null;
    const token = upto.slice(atIdx + 1);
    // Only allow word-ish chars in token
    const m = token.match(/^[A-Za-z0-9_-]{0,30}$/);
    if (!m) return null;
    return { start: atIdx, end: cursor, query: token };
  } catch (_) { return null; }
}

function closeMentionSuggest() {
  try {
    mentionIndex = -1;
    mentionSuggestEl.classList.remove('open');
    mentionSuggestEl.setAttribute('aria-expanded', 'false');
    mentionSuggestEl.innerHTML = '';
  } catch (_) {}
}

// Visual scroll masks for @mention dropdown
function updateMentionSuggestMask() {
  try {
    if (!mentionSuggestEl) return;
    const st = mentionSuggestEl.scrollTop;
    const max = Math.max(0, mentionSuggestEl.scrollHeight - mentionSuggestEl.clientHeight);
    const hasTop = st > 0;
    const hasBottom = st < (max - 1);
    mentionSuggestEl.classList.toggle('scroll-top', hasTop);
    mentionSuggestEl.classList.toggle('scroll-bottom', hasBottom);
  } catch (_) {}
}

function openMentionSuggest(query) {
  if (!mentionSuggestEl) return;
  const meName = getDisplayName(currentUser);
  const unique = new Map();
  activeUsers.forEach(u => {
    const name = String(u.username || '').trim();
    if (!name || name === meName) return;
    unique.set(name, u);
  });
  const names = Array.from(unique.keys());
  const q = String(query || '').toLowerCase();
  let filtered = names;
  if (q) filtered = names.filter(n => n.toLowerCase().includes(q));
  filtered.sort((a,b)=>{
    const al = a.toLowerCase(), bl = b.toLowerCase();
    const as = al.startsWith(q) ? 0 : 1;
    const bs = bl.startsWith(q) ? 0 : 1;
    if (as !== bs) return as - bs;
    const ai = q ? al.indexOf(q) : 0;
    const bi = q ? bl.indexOf(q) : 0;
    if (ai !== bi) return ai - bi;
    return al.localeCompare(bl);
  });
  const top = filtered.slice(0, 6);
  mentionSuggestEl.innerHTML = '';
  if (!top.length) { closeMentionSuggest(); return; }
  top.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'mention-suggest__item';
    item.setAttribute('role', 'option');
    item.setAttribute('data-name', name);
    if (i === 0) item.setAttribute('aria-selected', 'true');
    const avatar = document.createElement('div');
    avatar.className = 'mention-suggest__avatar';
    setAvatar(avatar, name, name);
    const label = document.createElement('div');
    label.className = 'mention-suggest__name';
    label.textContent = name;
    const hint = document.createElement('div');
    hint.className = 'mention-suggest__hint';
    hint.textContent = '@' + name;
    item.appendChild(avatar);
    item.appendChild(label);
    item.appendChild(hint);
    item.addEventListener('mousedown', (e) => { // use mousedown to avoid input blur
      e.preventDefault();
      applyMention(name);
    });
    mentionSuggestEl.appendChild(item);
  });
  mentionIndex = 0;
  mentionSuggestEl.classList.add('open');
  mentionSuggestEl.setAttribute('aria-expanded', 'true');
  try { updateMentionSuggestMask(); } catch (_) {}
}

function applyMention(name) {
  try {
    const el = messageInput;
    const cursor = el.selectionStart || el.value.length;
    const token = getMentionToken(el.value, cursor);
    if (!token) return closeMentionSuggest();
    const before = el.value.slice(0, token.start);
    const after = el.value.slice(token.end);
    const insert = `@${name} `;
    el.value = before + insert + after;
    const newPos = (before + insert).length;
    el.setSelectionRange(newPos, newPos);
    closeMentionSuggest();
    el.focus();
  } catch (_) { closeMentionSuggest(); }
}

// Insert a mention at the current cursor, even if no token is active
function insertMentionAtCursor(name) {
  try {
    const el = messageInput;
    const cursor = el.selectionStart || el.value.length;
    const before = el.value.slice(0, cursor);
    const after = el.value.slice(cursor);
    const insert = `@${name} `;
    el.value = before + insert + after;
    const newPos = (before + insert).length;
    el.setSelectionRange(newPos, newPos);
    el.focus();
  } catch (_) {}
}

function updateMentionSuggestions() {
  try {
    const el = messageInput;
    const cursor = el.selectionStart || el.value.length;
    const token = getMentionToken(el.value, cursor);
    if (!token) { closeMentionSuggest(); return; }
    openMentionSuggest(token.query);
  } catch (_) { closeMentionSuggest(); }
}

messageInput?.addEventListener('input', updateMentionSuggestions);
messageInput?.addEventListener('keydown', (e) => {
  if (!mentionSuggestEl?.classList.contains('open')) return;
  const items = Array.from(mentionSuggestEl.querySelectorAll('.mention-suggest__item'));
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    mentionIndex = (mentionIndex + 1) % items.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    mentionIndex = (mentionIndex - 1 + items.length) % items.length;
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const name = items[Math.max(0, mentionIndex)].getAttribute('data-name');
    if (name) applyMention(name);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeMentionSuggest();
  } else {
    return; // let input event handle filtering
  }
  items.forEach((it, idx) => {
    if (idx === mentionIndex) it.setAttribute('aria-selected', 'true');
    else it.removeAttribute('aria-selected');
  });
});

// Bind scroll listener once for mention dropdown
try { mentionSuggestEl?.addEventListener('scroll', () => updateMentionSuggestMask(), { passive: true }); } catch (_) {}

document.addEventListener('click', (e) => {
  try {
    if (!mentionSuggestEl) return;
    const within = mentionSuggestEl.contains(e.target) || messageInput?.contains(e.target);
    if (!within) closeMentionSuggest();
  } catch (_) {}
});

function escapeHtml(str) {
  return str.replace(/[&<>"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
function highlightMentions(text) {
  const safe = escapeHtml(text);
  // Convert URLs to safe anchors that we can enhance later
  const withLinks = safe.replace(/(https?:\/\/[^\s]+)/g, (m) => {
    const href = m;
    const display = href.length > 80 ? href.slice(0, 77) + '…' : href;
    return `<a href="${href}" class="msg__link" target="_blank" rel="noopener noreferrer" data-safe-link="true">${display}</a>`;
  });
  // Basic highlight for @DisplayName tokens (letters, numbers, dashes, underscores)
  return withLinks.replace(/(^|\s)@(\w[\w-]{1,30})/g, (m, pre, name) => `${pre}<span class="mention">@${name}</span>`);
}

// Enhance rendered links: attach warning click handler and show a lightweight preview
function enhanceLinks(container) {
  try {
    const links = container.querySelectorAll('a.msg__link');
    links.forEach((a) => {
      // Avoid binding multiple times
      if (!a.dataset.boundSafeClick) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const url = a.getAttribute('href');
          // Show refined safety warning before opening
          const ok = window.confirm("Heads up: You’re opening an external link. It may be unsafe or phishing. Only continue if you trust this site.");
          if (ok && url) {
            try { window.open(url, '_blank', 'noopener'); } catch (_) {}
          }
        });
        a.dataset.boundSafeClick = 'true';
      }
      // Insert a simple preview card just after the link (once)
      const next = a.nextElementSibling;
      if (!next || !next.classList || !next.classList.contains('link-preview')) {
        try {
          const url = new URL(a.getAttribute('href'));
          const host = url.hostname;
          const path = (url.pathname + (url.search || '')).replace(/\/$/, '') || '/';
          const card = document.createElement('div');
          card.className = 'link-preview';
          card.innerHTML = `
            <div class="link-preview__iconwrap">
              <img class="link-preview__icon" src="https://icons.duckduckgo.com/ip3/${host}.ico" alt="" onerror="this.style.display='none'" />
            </div>
            <div class="link-preview__info">
              <div class="link-preview__host">${host}</div>
              <div class="link-preview__path">${escapeHtml(path)}</div>
              <div class="link-preview__meta">
                <span class="link-preview__chip">External link</span>
                <span class="link-preview__note">Opens in new tab</span>
              </div>
            </div>
          `;
          a.insertAdjacentElement('afterend', card);
        } catch (_) {
          // ignore invalid URLs
        }
      }
    });
  } catch (_) {}
}
// Flag suspicious keywords ("passphrase" variations) and attach a warning tooltip
function flagSuspiciousKeywords(container, doc) {
  try {
    const html = container.innerHTML;
    // Helper to build an obfuscation-tolerant regex for a term
    const sep = '(?:[\\s\\-_.]*)';
    const cls = (ch) => {
      const map = {
        'a': '[aA@4]', 'e': '[eE3]', 'i': '[iI1!l]', 'o': '[oO0]', 's': '[sS$5]',
        'p': '[pP]', 'h': '[hH]', 'r': '[rR]', 'v': '[vV]', 't': '[tT7]', 'k': '[kK]', 'y': '[yY]', 'd': '[dD]'
      };
      return (map[ch] || `[${ch}${ch.toUpperCase()}]`) + '+'; // allow repeats
    };
    const build = (term) => term.split('').map((c) => cls(c)).join(sep);
    const passRe = new RegExp(build('passphrase'), 'gi');
    const seedRe = new RegExp(build('seedphrase'), 'gi');
    const privRe = new RegExp(build('privatekey'), 'gi');
    // Fast precheck to avoid heavy replaces when nothing relevant
    if (!(passRe.test(html) || seedRe.test(html) || privRe.test(html))) return false;
    let out = html;
    out = out.replace(passRe, (m) => `<span class="suspicious-kw" data-term="passphrase">${m}</span>`);
    out = out.replace(seedRe, (m) => `<span class="suspicious-kw" data-term="seed phrase">${m}</span>`);
    out = out.replace(privRe, (m) => `<span class="suspicious-kw" data-term="private key">${m}</span>`);
    if (out === html) return false;
    container.innerHTML = out;
    const els = container.querySelectorAll('.suspicious-kw');
    const terms = new Set();
    els.forEach((el) => { const t = el.getAttribute('data-term'); if (t) terms.add(t); });
    container.dataset.suspiciousTerms = Array.from(terms).join(', ');
    return els.length > 0;
  } catch (_) {
    return false;
  }
}
function registerMentionIfTarget(doc) {
  const myName = getDisplayName(currentUser);
  const text = String(doc?.content || '');
  if (!myName || !text.includes('@')) return;
  const has = new RegExp(`(^|\\s)@${myName}(?![\w-])`).test(text);
  if (has && doc.userId !== (currentUser?.$id || 'unknown')) {
    const entryId = doc.$id || doc.id || null;
    const entryTs = doc.timestamp || doc.$createdAt || new Date().toISOString();
    const entryFrom = doc.username || 'Unknown';
    const duplicate = mentionsList.some(m => (entryId && m.id === entryId) || (!entryId && m.from === entryFrom && m.ts === entryTs));
    if (duplicate) return;
    const entry = { id: entryId, from: entryFrom, ts: entryTs, text: text, read: false };
    mentionsList.push(entry);
    saveMentions();
    updateMentionsBadge();
    renderMentionsMenu();
    playNotifySound();
  }
}

function registerReplyIfTarget(doc) {
  try {
    const replyId = doc?.replyTo;
    if (!replyId) return;
    const ref = messageById.get(replyId);
    if (!ref) return;
    const myId = currentUser?.$id || 'unknown';
    const myName = getDisplayName(currentUser);
    const targetsMe = (ref.userId && ref.userId === myId) || (ref.username && ref.username === myName);
    if (!targetsMe) return;
    if (doc.userId === myId) return; // ignore self-replies
    const entryId = doc.$id || doc.id || null;
    const entryTs = doc.timestamp || doc.$createdAt || new Date().toISOString();
    const entryFrom = doc.username || 'Unknown';
    const duplicate = mentionsList.some(m => (entryId && m.id === entryId) || (!entryId && m.from === entryFrom && m.ts === entryTs));
    if (duplicate) return;
    const entry = { id: entryId, from: entryFrom, ts: entryTs, text: String(doc.content || ''), read: false, kind: 'reply' };
    mentionsList.push(entry);
    saveMentions();
    updateMentionsBadge();
    renderMentionsMenu();
    playNotifySound();
  } catch (_) {}
}

function isVerified() {
  return Boolean(currentUser?.emailVerification);
}

function enforceVerified() {
  const hasSession = !!currentUser;
  const guest = hasSession ? !currentUser?.email : false;
  // Allow messaging for both guests and logged-in users regardless of verification
  const verified = hasSession ? true : false;
  try {
    if (messageInput) {
      // Ban enforcement will further restrict input below
      messageInput.disabled = !verified;
      messageInput.placeholder = verified ? 'Type a message…' : 'Reconnecting…';
    }
    if (sendButton) sendButton.disabled = !verified;
  } catch (_) {}
}

// --- Ban helpers ---
const BAN_STORE_KEY = 'solchat_bans';
let bans = {};
try { bans = JSON.parse(localStorage.getItem(BAN_STORE_KEY) || '{}'); } catch (_) { bans = {}; }

function saveBans() {
  try { localStorage.setItem(BAN_STORE_KEY, JSON.stringify(bans)); } catch (_) {}
}

function getBanKeyFromDoc(doc) {
  const uid = doc?.userId || doc?.$id || '';
  if (uid && uid !== 'unknown') return `uid:${uid}`;
  const name = String(doc?.username || '').trim();
  return `name:${name}`;
}

function getBanKeyFromUser(user) {
  const uid = user?.$id || '';
  if (uid && uid !== 'unknown') return `uid:${uid}`;
  const name = getDisplayName(user);
  return `name:${name}`;
}

function isBannedUser(user) {
  if (!user || isAdmin(user)) return null;
  const key = getBanKeyFromUser(user);
  const b = bans[key];
  if (!b) return null;
  if (b.until === 'forever') return b;
  const untilTs = new Date(b.until).getTime();
  if (Date.now() < untilTs) return b;
  try { delete bans[key]; saveBans(); } catch (_) {}
  return null;
}

function enforceBanUI() {
  const b = isBannedUser(currentUser);
  if (!messageInput || !sendButton) return;
  if (b) {
    messageInput.disabled = true;
    sendButton.disabled = true;
    const untilText = b.until === 'forever' ? 'Forever' : new Date(b.until).toLocaleString();
    messageInput.placeholder = `You are banned until ${untilText}`;
  } else {
    // fall back to verified state
    const hasSession = !!currentUser;
    const guest = hasSession ? !currentUser?.email : false;
    const verified = hasSession ? (guest ? true : isVerified()) : false;
    messageInput.disabled = !verified;
    sendButton.disabled = !verified;
    messageInput.placeholder = verified ? 'Type a message…' : (hasSession ? 'Verify your email to send messages' : 'Reconnecting…');
  }
}

function postBanEvent(key, name, until) {
  const by = getDisplayName(currentUser);
  const line = `[BAN] key=${key} name=${name} until=${until} by=${by}`;
  return postEvent(line);
}

function applyBanForDoc(targetDoc, durationMinutes) {
  if (!isAdmin(currentUser)) {
    toast('Only admin can ban users', 'error');
    return;
  }
  const key = getBanKeyFromDoc(targetDoc);
  const name = String(targetDoc?.username || 'Unknown');
  const until = durationMinutes == null ? 'forever' : new Date(Date.now() + durationMinutes * 60000).toISOString();
  bans[key] = { key, name, until, by: getDisplayName(currentUser) };
  saveBans();
  postBanEvent(key, name, until);
  toast(`Banned ${name} ${until === 'forever' ? 'forever' : `until ${new Date(until).toLocaleString()}`}`);
  // Reflect UI immediately if current user is affected
  enforceBanUI();
}

function postUnbanEvent(key, name) {
  const by = getDisplayName(currentUser);
  const line = `[UNBAN] key=${key} name=${name} by=${by}`;
  return postEvent(line);
}

function unbanForDoc(targetDoc) {
  if (!isAdmin(currentUser)) {
    toast('Only admin can unban users', 'error');
    return;
  }
  const key = getBanKeyFromDoc(targetDoc);
  const name = String(targetDoc?.username || 'Unknown');
  if (!bans[key]) {
    toast(`${name} is not currently banned`);
    return;
  }
  try { delete bans[key]; saveBans(); } catch (_) {}
  postUnbanEvent(key, name);
  toast(`Unbanned ${name}`);
  enforceBanUI();
}

// Positioning helper for profile dropdown (fixed overlay)
function positionProfileMenu() {
  try {
    const rect = profileButton.getBoundingClientRect();
    const top = Math.round(rect.bottom + 6);
    const right = Math.max(6, Math.round(window.innerWidth - rect.right));
    profileMenu.style.top = `${top}px`;
    profileMenu.style.right = `${right}px`;
  } catch (_) {}
}

// Ensure dropdown is not clipped by header: move to body overlay
try {
  if (profileMenu && profileMenu.parentElement && profileMenu.parentElement.tagName !== 'BODY') {
    document.body.appendChild(profileMenu);
  }
} catch (_) {}

// Mentions dropdown: fixed overlay positioning
function positionMentionsMenu() {
  try {
    const rect = mentionsButton.getBoundingClientRect();
    const top = Math.round(rect.bottom + 6);
    const right = Math.max(6, Math.round(window.innerWidth - rect.right));
    mentionsMenu.style.top = `${top}px`;
    mentionsMenu.style.right = `${right}px`;
  } catch (_) {}
}

// Ensure mentions menu is in body to avoid clipping
try {
  if (mentionsMenu && mentionsMenu.parentElement && mentionsMenu.parentElement.tagName !== 'BODY') {
    document.body.appendChild(mentionsMenu);
  }
} catch (_) {}

// Appwrite SDK
const client = new Appwrite.Client();
client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
// Users API (requires server privileges); we’ll use it if available
let usersApi = null;
try {
  usersApi = new Appwrite.Users(client);
} catch (_) {}

// Helper: clear any locally cached Appwrite session so SDK doesn't block new sessions
function clearLocalAppwriteSession() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      keys.push(k);
    }
    keys.forEach((k) => {
      const lk = String(k || '').toLowerCase();
      if (lk.includes('appwrite') && lk.includes('session')) {
        try { localStorage.removeItem(k); } catch (_) {}
      }
      if (lk.startsWith('a_session') || lk.includes('a_session')) {
        try { localStorage.removeItem(k); } catch (_) {}
      }
    });
  } catch (_) {}
}

// Connectivity guard: check if Appwrite endpoint is reachable (CORS + network)
async function isAppwriteReachable(timeoutMs = 2000) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const url = `${APPWRITE_ENDPOINT.replace(/\/$/, '')}/health/version`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: ctrl.signal, mode: 'no-cors' });
      clearTimeout(timer);
      // Treat any non-error fetch as reachable; status 200 expected
      // In no-cors mode, opaque responses have status 0 — still treat as reachable
      return !!res;
    } catch (_) {
      clearTimeout(timer);
      return false;
    }
  } catch (_) { return false; }
}

// Helper: Realtime subscribe compatibility (v13/v14)
function subscribe(channel, cb) {
  if (typeof client.subscribe === 'function') {
    // v14+ style
    return client.subscribe(channel, cb);
  } else {
    const realtime = new Appwrite.Realtime(client);
    return realtime.subscribe(channel, cb);
  }
}

// Guest display name generation and persistence
const ADJECTIVES = ['Neon','Quantum','Crystal','Hyper','Turbo','Shadow','Lunar','Solar','Nova','Stellar','Cipher','Vector','Zenith','Aurora','Iridescent'];
const NOUNS = ['Sol','Photon','Node','Validator','Drift','Ray','Helix','Signal','Circuit','Packet','Orb','Flux','Pulse','Vertex','Beacon'];
function randomGuestName() {
  // Use local lists to avoid touching block-scoped globals before init in early calls
  const adj = ['Neon','Quantum','Crystal','Hyper','Turbo','Shadow','Lunar','Solar','Nova','Stellar','Cipher','Vector','Zenith','Aurora','Iridescent'];
  const nouns = ['Sol','Photon','Node','Validator','Drift','Ray','Helix','Signal','Circuit','Packet','Orb','Flux','Pulse','Vertex','Beacon'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${a}-${n}-${num}`;
}
function getDisplayName(user) {
  const name = user?.name;
  const email = user?.email;
  if (name && name.trim()) return name;
  if (email && email.trim()) return email;
  const userId = user?.$id || 'guest';
  const key = `solchat_display_name_${userId}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = randomGuestName();
  localStorage.setItem(key, generated);
  return generated;
}

// UI Helpers
function showView(view) {
  const isAuth = view === 'auth';
  const isChat = view === 'chat';
  const isLanding = view === 'landing';
  authView.classList.toggle('hidden', !isAuth);
  chatView.classList.toggle('hidden', !isChat);
  landingView?.classList.toggle('hidden', !isLanding);
  // Keep profile dropdown available on landing too
  profileButton.disabled = false;
  try { localStorage.setItem('solchat_last_view', view); } catch (_) {}
  // Keep URL hash in sync with the active view so refresh persists context
  try {
    const url = new URL(window.location.href);
    const desiredHash = `#${view}`;
    if (url.hash !== desiredHash) {
      url.hash = view;
      history.replaceState({}, document.title, url.toString());
    }
  } catch (_) {}
  // Update input mounting when view changes
  try { updateInputMount(); } catch (_) {}
}

function showLoading(show) {
  loadingEl.classList.toggle('hidden', !show);
}

function toast(message, type = 'info') {
  const div = document.createElement('div');
  div.className = `toast ${type === 'error' ? 'toast--error' : ''}`;
  div.textContent = message;
  toastsEl.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// Rate-limit helpers
function isRateLimited() {
  return Date.now() < rateLimitUntil;
}
function startRateLimitCooldown(ms = 4000, message = 'Rate limit exceeded. Please try again shortly.') {
  rateLimitUntil = Date.now() + ms;
  try { toast(message, 'error'); } catch (_) {}
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

// Reply state & cache
let replyTarget = null;
const messageById = new Map();
// Track pinned messages by id and render a small bar at top
let pinnedMessageIds = new Set();
// Total registered users from Auth. Fallback to presence count when null.
let totalUsersCount = null;

function ensurePinnedBar() {
  const messagesContainer = document.getElementById('messages');
  let bar = document.getElementById('pinnedBar');
  if (bar) {
    try {
      if (bar.parentNode !== messagesContainer) {
        messagesContainer.insertAdjacentElement('afterbegin', bar);
      }
    } catch (_) {
      // fallback: if insertAdjacentElement fails, replace manually
      try { messagesContainer.prepend(bar); } catch (_) {}
    }
    return bar;
  }
  bar = document.createElement('div');
  bar.id = 'pinnedBar';
  bar.className = 'pinned-bar';
  try {
    messagesContainer.insertAdjacentElement('afterbegin', bar);
  } catch (_) {
    messagesContainer.parentNode.insertBefore(bar, messagesContainer);
  }
  return bar;
}

function renderPinnedItem(doc) {
  const el = document.createElement('div');
  el.className = 'pinned-item';
  el.setAttribute('data-doc-id', doc.$id);
  const author = doc.username || 'Unknown';
  const content = (doc.content || '').substring(0, 50);
  el.innerHTML = `<span class="pinned-item__author">${author}:</span> <span class="pinned-item__content">${content}...</span>`;
  el.addEventListener('click', () => {
    const targetEl = findMessageElById(doc.$id);
    if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  return el;
}

function updatePinnedBar() {
  const bar = ensurePinnedBar();
  if (!bar) return;
  bar.innerHTML = '';
  if (pinnedMessageIds.size === 0) {
    bar.classList.remove('visible');
    return;
  }
  // Show only the most recently pinned message as a top banner
  const ids = Array.from(pinnedMessageIds);
  const lastId = ids[ids.length - 1];
  const doc = messageById.get(lastId);

  const card = document.createElement('div');
  card.className = 'pinned-card';
  card.setAttribute('data-doc-id', lastId || '');

  if (doc) {
    const author = doc.username || 'Unknown';
    const when = formatTime(doc.timestamp || doc.$createdAt) || '';
    const raw = String(doc.content || '');
    const fullEsc = escapeHtml(raw.trim());
    const fullHtml = fullEsc.replace(/\n/g, '<br>');
    const PREVIEW_CHARS = 200;
    const needsReadMore = fullEsc.length > PREVIEW_CHARS || raw.includes('\n');
    const previewHtml = needsReadMore ? `${fullEsc.slice(0, PREVIEW_CHARS)}…` : fullEsc;
    card.innerHTML = `
      <div class="pinned-card__meta">
        <span class="pinned-card__icon">📌</span>
        <span class="pinned-card__author">${escapeHtml(author)}</span>
        <span class="pinned-card__sep">·</span>
        <span class="pinned-card__time">${escapeHtml(when)}</span>
      </div>
      <div class="pinned-card__text">
        <span class="pinned__preview">${previewHtml}</span>
        <span class="pinned__full" style="display:none">${fullHtml}</span>
      </div>
    `;
    // Append live view counter (eye icon + compact count) with hover names
    try {
      const metaEl = card.querySelector('.pinned-card__meta');
      if (metaEl) {
        // Position container relatively to anchor the hover menu within card
        try { metaEl.style.position = 'relative'; } catch (_) {}
        const viewsBtn = document.createElement('button');
        viewsBtn.type = 'button';
        viewsBtn.className = 'pinned__views msg__action--seen';
        const msgTs = new Date(doc.timestamp || doc.$createdAt || Date.now()).getTime();
        const computeViewerNames = () => {
          try {
            const candidates = (presenceDocs || []).filter(d => {
              const tsStr = d.lastSeenMessageTs || d.lastSeenAt || d.updatedAt || d.$updatedAt || d.$createdAt;
              const t = tsStr ? new Date(tsStr).getTime() : 0;
              return t >= msgTs;
            });
            return candidates.map(d => d.username || 'Unknown');
          } catch (_) { return []; }
        };
        const formatCompactCount = (n) => {
          if (n >= 1000000000) return `${Math.floor(n / 1000000000)}B`;
          if (n >= 1000000) return `${Math.floor(n / 1000000)}M`;
          if (n >= 1000) return `${Math.floor(n / 1000)}k`;
          return `${n}`;
        };
        const renderViewsBtnUI = () => {
          const count = computeViewerNames().length;
          const compact = formatCompactCount(count);
          viewsBtn.innerHTML = `
            <span class="seen__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
                <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6" fill="none"></circle>
              </svg>
            </span>
            <span class="seen__count">${compact}</span>
          `;
          viewsBtn.title = `${count} viewers`;
          viewsBtn.setAttribute('aria-label', `${count} viewers`);
        };
        renderViewsBtnUI();
        const seenMenu = document.createElement('div');
        seenMenu.className = 'msg__menu msg__menu--seen';
        const positionMenu = () => {
          try {
            const parent = metaEl;
            const btnRect = viewsBtn.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            const top = Math.round((btnRect.bottom - parentRect.top) + 6);
            const menuWidth = seenMenu.offsetWidth || seenMenu.getBoundingClientRect().width || 160;
            const parentWidth = parentRect.width;
            let left = Math.round(btnRect.left - parentRect.left);
            left = Math.max(0, Math.min(left, parentWidth - menuWidth));
            seenMenu.style.top = `${top}px`;
            seenMenu.style.left = `${left}px`;
            seenMenu.style.right = 'auto';
          } catch (_) {}
        };
        const renderMenu = () => {
          try {
            seenMenu.innerHTML = '';
            const names = computeViewerNames();
            try { renderViewsBtnUI(); } catch (_) {}
            if (!names.length) {
              const empty = document.createElement('div');
              empty.className = 'msg__menu-item';
              empty.textContent = 'No viewers yet';
              seenMenu.appendChild(empty);
            } else {
              names.forEach((name) => {
                const item = document.createElement('div');
                item.className = 'msg__menu-item';
                item.textContent = name;
                seenMenu.appendChild(item);
              });
            }
          } catch (_) {}
        };
        viewsBtn.addEventListener('mouseenter', () => {
          try { renderViewsBtnUI(); } catch (_) {}
          renderMenu();
          seenMenu.classList.add('open');
          setTimeout(positionMenu, 0);
        });
        viewsBtn.addEventListener('mouseleave', () => {
          setTimeout(() => {
            try {
              const within = seenMenu.matches(':hover') || viewsBtn.matches(':hover');
              if (!within) seenMenu.classList.remove('open');
            } catch (_) { seenMenu.classList.remove('open'); }
          }, 120);
        });
        seenMenu.addEventListener('mouseleave', () => {
          try { seenMenu.classList.remove('open'); } catch (_) {}
        });
        // Insert separator and views button
        const sep = document.createElement('span');
        sep.className = 'pinned-card__sep';
        sep.textContent = '·';
        metaEl.appendChild(sep);
        metaEl.appendChild(viewsBtn);
        metaEl.appendChild(seenMenu);
      }
    } catch (_) {}
    if (needsReadMore) {
      const readBtn = document.createElement('button');
      readBtn.type = 'button';
      readBtn.className = 'pinned-card__readmore';
      readBtn.textContent = 'Read more';
      readBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = card.classList.toggle('pinned-card--expanded');
        const previewEl = card.querySelector('.pinned__preview');
        const fullEl = card.querySelector('.pinned__full');
        if (expanded) {
          if (previewEl) previewEl.style.display = 'none';
          if (fullEl) fullEl.style.display = 'inline';
          readBtn.textContent = 'Collapse';
        } else {
          if (previewEl) previewEl.style.display = 'inline';
          if (fullEl) fullEl.style.display = 'none';
          readBtn.textContent = 'Read more';
        }
      });
      card.appendChild(readBtn);
    }
    card.addEventListener('click', () => {
      const targetEl = findMessageElById(doc.$id);
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    // Provide quick unpin for admins
    if (isAdmin(currentUser)) {
      const actions = document.createElement('div');
      actions.className = 'pinned-card__actions';
      const btn = document.createElement('button');
      btn.className = 'btn btn--ghost pinned-card__unpin';
      btn.type = 'button';
      btn.innerHTML = '<span class="pin__icon" aria-hidden="true">📌</span>';
      btn.title = 'Unpin';
      btn.setAttribute('aria-label', 'Unpin');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { unpinForDoc(doc); } catch (_) {}
      });
      actions.appendChild(btn);
      card.appendChild(actions);
    }
  } else {
    card.innerHTML = `
      <div class="pinned-card__meta"><span class="pinned-card__icon">📌</span> <span class="pinned-card__author">Pinned message</span></div>
      <div class="pinned-card__text">Tap to jump</div>
    `;
    card.addEventListener('click', () => {
      const targetEl = lastId && findMessageElById(lastId);
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  bar.appendChild(card);
  bar.classList.add('visible');
}

function applyPinnedStateUIForId(id, isPinned) {
  const msgEl = findMessageElById(id);
  if (!msgEl) return;
  const pinBtn = msgEl.querySelector('.msg__action--pin');
  const bubble = msgEl.querySelector('.msg__bubble');
  if (isPinned) {
    bubble?.classList.add('msg__bubble--pinned');
    if (pinBtn) {
      pinBtn.innerHTML = '<span class="pin__icon" aria-hidden="true">📌</span>';
      pinBtn.title = 'Unpin';
      pinBtn.setAttribute('aria-label', 'Unpin');
    }
  } else {
    bubble?.classList.remove('msg__bubble--pinned');
    if (pinBtn) {
      pinBtn.innerHTML = '<span class="pin__icon" aria-hidden="true">📌</span>';
      pinBtn.title = 'Pin';
      pinBtn.setAttribute('aria-label', 'Pin');
    }
  }
}

function postPinEvent(id) {
  const by = getDisplayName(currentUser);
  const line = `[PIN] id=${id} by=${by}`;
  return postEvent(line);
}

function applyPinForDoc(targetDoc) {
  if (!isAdmin(currentUser)) {
    toast('Only admin can pin messages', 'error');
    return;
  }
  const id = targetDoc.$id;
  if (!id) return;
  pinnedMessageIds.add(id);
  postPinEvent(id);
  toast(`Pinned message`);
  updatePinnedBar();
  applyPinnedStateUIForId(id, true);
}

function postUnpinEvent(id) {
  const by = getDisplayName(currentUser);
  const line = `[UNPIN] id=${id} by=${by}`;
  return postEvent(line);
}

function unpinForDoc(targetDoc) {
  if (!isAdmin(currentUser)) {
    toast('Only admin can unpin messages', 'error');
    return;
  }
  const id = targetDoc.$id;
  if (!id) return;
  if (!pinnedMessageIds.has(id)) {
    toast(`Message is not currently pinned`);
    return;
  }
  pinnedMessageIds.delete(id);
  postUnpinEvent(id);
  toast(`Unpinned message`);
  updatePinnedBar();
  applyPinnedStateUIForId(id, false);
}

async function refreshTotalUsersFromAuth() {
  if (!usersApi) return;
  try {
    // Request minimal page; we only need `total` from response
    const res = await usersApi.list([Appwrite.Query.limit(1)]);
    if (res && typeof res.total === 'number') {
      totalUsersCount = res.total;
    }
  } catch (err) {
    // Unauthorized or network blocked in client context; fallback remains
    console.warn('Auth users total unavailable; using presence fallback.', err?.message || err);
    totalUsersCount = null;
  }
}

function renderMessage(doc) {
  const docId = doc.$id || doc.id || null;
  const existing = findMessageElById(docId);
  const isEvent = isEventMessage(doc);
  const isMe = !isEvent && !!(doc.userId && currentUser?.$id && doc.userId === currentUser.$id);
  if (docId) messageById.set(docId, doc);

  const updateEl = (el) => {
    const user = el.querySelector('.msg__user');
    const time = el.querySelector('.msg__time');
    const content = el.querySelector('.msg__content');
    const avatarEl = el.querySelector('.msg__avatar');
    const bubbleEl = el.querySelector('.msg__bubble');
    if (user) setNameWithBadge(user, doc.username || 'Unknown', doc);
    if (time) time.textContent = formatTime(doc.timestamp || doc.$createdAt);
    if (content) {
      const raw = String(doc.content || '');
      // Only parse the first line of content; ignore any additional lines
      const firstLine = raw.trim().split('\n')[0].trim();
      if (firstLine.startsWith('[BAN]')) {
        const m = firstLine.match(/^\[BAN\]\s+key=(.+?)\s+name=(.+?)\s+until=(.+?)(?:\s+by=(.+))?$/);
        if (m) {
          const [, key, name, until, by] = m;
          // Apply ban locally when rendering history
          bans[key] = { key, name, until, by };
          saveBans();
          const untilText = until === 'forever' ? 'Forever' : new Date(until).toLocaleString();
          const who = by ? by : 'Admin';
          content.textContent = `${who} has banned ${name} ${untilText === 'Forever' ? 'forever' : `until ${untilText}`}`;
        } else {
          content.textContent = firstLine;
        }
      } else if (firstLine.startsWith('[UNBAN]')) {
        const m = firstLine.match(/^\[UNBAN\]\s+key=(.+?)\s+name=(.+?)(?:\s+by=(.+))?$/);
        if (m) {
          const [, key, name, by] = m;
          try { delete bans[key]; saveBans(); } catch (_) {}
          const who = by ? by : 'Admin';
          content.textContent = `${who} has unbanned ${name}`;
        } else {
          content.textContent = firstLine;
        }
      } else if (firstLine.startsWith('[PIN]')) {
        const m = firstLine.match(/^\[PIN\]\s+id=(.+?)(?:\s+by=(.+))?$/);
        if (m) {
          const [, id, by] = m;
          pinnedMessageIds.add(id);
          try { updatePinnedBar(); } catch (_) {}
          const who = by ? by : 'Admin';
          content.textContent = `${who} pinned a message`;
          try { applyPinnedStateUIForId(id, true); } catch (_) {}
        } else {
          content.textContent = firstLine;
        }
      } else if (firstLine.startsWith('[UNPIN]')) {
        const m = firstLine.match(/^\[UNPIN\]\s+id=(.+?)(?:\s+by=(.+))?$/);
        if (m) {
          const [, id, by] = m;
          try { pinnedMessageIds.delete(id); } catch (_) {}
          try { updatePinnedBar(); } catch (_) {}
          const who = by ? by : 'Admin';
          content.textContent = `${who} unpinned a message`;
          try { applyPinnedStateUIForId(id, false); } catch (_) {}
        } else {
          content.textContent = firstLine;
        }
      } else {
        content.innerHTML = highlightMentions(raw);
        // Enhance any rendered links with warning click and preview
        enhanceLinks(content);
        // Flag suspicious keyword usage and attach tooltip
        const suspiciousFound = flagSuspiciousKeywords(content, doc);
        if (bubbleEl) {
          const existingFlag = bubbleEl.querySelector('.msg__flag');
          // Do not show the flag on your own messages
          if (suspiciousFound && !isMe) {
            const terms = content.dataset.suspiciousTerms || 'passphrase';
            const warnText = `If ${doc.username || 'this user'} asks ${terms} with you do not share it, platform will not be responsible for it`;
            if (!existingFlag) {
              const flag = document.createElement('div');
              flag.className = 'msg__flag';
              flag.textContent = 'Suspicious';
              flag.addEventListener('mouseenter', () => showBadgeTooltip(flag, warnText));
              flag.addEventListener('mouseleave', () => hideBadgeTooltip());
              flag.dataset.boundFlagTooltip = 'true';
              bubbleEl.appendChild(flag);
            } else {
              existingFlag.textContent = 'Suspicious';
              if (!existingFlag.dataset.boundFlagTooltip) {
                existingFlag.addEventListener('mouseenter', () => showBadgeTooltip(existingFlag, warnText));
                existingFlag.addEventListener('mouseleave', () => hideBadgeTooltip());
                existingFlag.dataset.boundFlagTooltip = 'true';
              }
            }
          } else {
            if (existingFlag) existingFlag.remove();
          }
        }
      }
    }
    if (avatarEl) setAvatar(avatarEl, doc.username || 'Unknown', doc.userId || doc.$id);
    const quote = el.querySelector('.msg__quote');
    if (quote) updateQuote(quote, doc.replyTo);
    if (isEvent) {
      el.classList.add('msg--event');
      bubbleEl?.classList.add('msg__bubble--event');
      el.querySelector('.msg__meta')?.remove();
      el.querySelector('.msg__actions')?.remove();
      el.querySelector('.msg__quote')?.remove();
      el.querySelector('.msg__avatar')?.remove();
    }
    // Apply own-message styling dynamically
    try {
      if (isMe) {
        el.classList.add('msg--me');
        bubbleEl?.classList.add('msg__bubble--me');
        // Hide avatar for own messages if present
        el.querySelector('.msg__avatar')?.remove();
      } else {
        el.classList.remove('msg--me');
        bubbleEl?.classList.remove('msg__bubble--me');
      }
    } catch (_) {}
  };

  if (existing) {
    updateEl(existing);
    return existing;
  }

  const wrap = document.createElement('div');
  wrap.className = 'msg';
  if (docId) wrap.setAttribute('data-doc-id', docId);
  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';
  if (isEvent) {
    wrap.classList.add('msg--event');
    bubble.classList.add('msg__bubble--event');
  }
  if (isMe) {
    wrap.classList.add('msg--me');
    bubble.classList.add('msg__bubble--me');
  }
  let avatar;
  if (!isEvent && !isMe) {
    avatar = document.createElement('div');
    avatar.className = 'msg__avatar';
    setAvatar(avatar, doc.username || 'Unknown', doc.userId || doc.$id);
  }

  if (!isEvent && doc.replyTo) {
    const quote = document.createElement('div');
    quote.className = 'msg__quote';
    updateQuote(quote, doc.replyTo);
    bubble.appendChild(quote);
  }

  if (!isEvent) {
    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    const user = document.createElement('div');
    user.className = 'msg__user';
    setNameWithBadge(user, doc.username || 'Unknown', doc);
    const time = document.createElement('div');
    time.className = 'msg__time';
    time.textContent = formatTime(doc.timestamp || doc.$createdAt);
    meta.appendChild(user);
    meta.appendChild(time);
    bubble.appendChild(meta);
  }

  const content = document.createElement('div');
  content.className = 'msg__content';
  content.textContent = doc.content || '';
  bubble.appendChild(content);
  if (!isEvent) {
    const actions = document.createElement('div');
    actions.className = 'msg__actions';
    // Position actions relatively to anchor menus/tooltips
    actions.style.position = 'relative';
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'msg__action';
    replyBtn.textContent = 'Reply';
    replyBtn.addEventListener('click', () => setReplyTarget(doc));
    actions.appendChild(replyBtn);

    // Seen-by button with hover menu (eye icon + compact counter)
    const seenBtn = document.createElement('button');
    seenBtn.type = 'button';
    seenBtn.className = 'msg__action msg__action--seen';
    const msgTs = new Date(doc.timestamp || doc.$createdAt || Date.now()).getTime();
    const computeViewerNames = () => {
      try {
        const candidates = (presenceDocs || []).filter(d => {
          const tsStr = d.lastSeenMessageTs || d.lastSeenAt || d.updatedAt || d.$updatedAt || d.$createdAt;
          const t = tsStr ? new Date(tsStr).getTime() : 0;
          return t >= msgTs;
        });
        return candidates.map(d => d.username || 'Unknown');
      } catch (_) { return []; }
    };
    const formatCompactCount = (n) => {
      if (n >= 1000000000) return `${Math.floor(n / 1000000000)}B`;
      if (n >= 1000000) return `${Math.floor(n / 1000000)}M`;
      if (n >= 1000) return `${Math.floor(n / 1000)}k`;
      return `${n}`;
    };
    const renderSeenButtonUI = () => {
      const count = computeViewerNames().length;
      const compact = formatCompactCount(count);
      seenBtn.innerHTML = `
        <span class="seen__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6" fill="none"></circle>
          </svg>
        </span>
        <span class="seen__count">${compact}</span>
      `;
      seenBtn.title = `${count} viewers`;
      seenBtn.setAttribute('aria-label', `${count} viewers`);
    };
    renderSeenButtonUI();
    const seenMenu = document.createElement('div');
    seenMenu.className = 'msg__menu msg__menu--seen';
    // Position menu directly under the Seen by button within actions
    const positionSeenMenu = () => {
      try {
        const parent = actions; // actions is relative positioned
        const btnRect = seenBtn.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const top = Math.round((btnRect.bottom - parentRect.top) + 6);
        const menuWidth = seenMenu.offsetWidth || seenMenu.getBoundingClientRect().width || 160;
        const parentWidth = parentRect.width;
        const isMeSide = (wrap && wrap.classList && wrap.classList.contains('msg--me'));
        let left;
        if (isMeSide) {
          // Align menu right edge to button right edge
          const btnRightWithinParent = Math.round(btnRect.right - parentRect.left);
          left = btnRightWithinParent - menuWidth;
        } else {
          // Align menu left edge to button left edge
          left = Math.round(btnRect.left - parentRect.left);
        }
        // Clamp within parent bounds
        left = Math.max(0, Math.min(left, parentWidth - menuWidth));
        seenMenu.style.top = `${top}px`;
        seenMenu.style.left = `${left}px`;
        seenMenu.style.right = 'auto';
      } catch (_) {}
    };
    const renderSeenMenu = () => {
      try {
        seenMenu.innerHTML = '';
        // Compute users whose lastSeenMessageTs >= this message timestamp
        const candidates = (presenceDocs || []).filter(d => {
          const tsStr = d.lastSeenMessageTs || d.lastSeenAt || d.updatedAt || d.$updatedAt || d.$createdAt;
          const t = tsStr ? new Date(tsStr).getTime() : 0;
          return t >= msgTs;
        });
        const names = candidates.map(d => d.username || 'Unknown');
        // Refresh the button count when opening the menu
        try { renderSeenButtonUI(); } catch (_) {}
        if (!names.length) {
          const empty = document.createElement('div');
          empty.className = 'msg__menu-item';
          empty.textContent = 'No viewers yet';
          seenMenu.appendChild(empty);
        } else {
          names.forEach((name) => {
            const item = document.createElement('div');
            item.className = 'msg__menu-item';
            item.textContent = name;
            item.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              try { insertMentionAtCursor(name); } catch (_) {}
              try { seenMenu.classList.remove('open'); } catch (_) {}
            });
            seenMenu.appendChild(item);
          });
        }
      } catch (_) {}
    };
    seenBtn.addEventListener('mouseenter', () => {
      // Update count on hover to reflect latest presence
      try { renderSeenButtonUI(); } catch (_) {}
      renderSeenMenu();
      seenMenu.classList.add('open');
      // Position after open to get accurate width for right-edge alignment
      setTimeout(positionSeenMenu, 0);
    });
    seenBtn.addEventListener('mouseleave', () => {
      // allow moving into the menu without flicker
      setTimeout(() => {
        try {
          const within = seenMenu.matches(':hover') || seenBtn.matches(':hover');
          if (!within) seenMenu.classList.remove('open');
        } catch (_) { seenMenu.classList.remove('open'); }
      }, 120);
    });
    seenMenu.addEventListener('mouseleave', () => {
      try { seenMenu.classList.remove('open'); } catch (_) {}
    });
    actions.appendChild(seenBtn);
    actions.appendChild(seenMenu);

    // Admin ban menu (three dots)
    if (isAdmin(currentUser)) {
      // Pin/Unpin control
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'msg__action msg__action--pin';
      const isPinnedNow = !!(docId && pinnedMessageIds.has(docId));
      pinBtn.innerHTML = '<span class="pin__icon" aria-hidden="true">📌</span>';
      pinBtn.title = isPinnedNow ? 'Unpin' : 'Pin';
      pinBtn.setAttribute('aria-label', isPinnedNow ? 'Unpin' : 'Pin');
      if (!docId) {
        pinBtn.disabled = true;
        pinBtn.title = 'Wait until message is saved';
      }
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!docId) return;
        if (pinnedMessageIds.has(docId)) {
          unpinForDoc(doc);
        } else {
          applyPinForDoc(doc);
        }
      });
      actions.appendChild(pinBtn);

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'msg__action';
      moreBtn.textContent = '⋯';
      const menu = document.createElement('div');
      menu.className = 'msg__menu';
      const targetKey = getBanKeyFromDoc(doc);
      const addItem = (label, mins) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'msg__menu-item';
        item.textContent = label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.classList.remove('open');
          applyBanForDoc(doc, mins);
        });
        menu.appendChild(item);
      };
      addItem('Ban 10 minutes', 10);
      addItem('Ban 30 minutes', 30);
      addItem('Ban 1 hour', 60);
      addItem('Ban Forever', null);
      // Unban option (visible if currently banned)
      const unbanItem = document.createElement('button');
      unbanItem.type = 'button';
      unbanItem.className = 'msg__menu-item';
      unbanItem.textContent = 'Unban';
      if (!bans[targetKey]) {
        unbanItem.style.opacity = '0.6';
      }
      unbanItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('open');
        unbanForDoc(doc);
      });
      menu.appendChild(unbanItem);
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      });
      document.addEventListener('click', () => menu.classList.remove('open'));
      actions.appendChild(moreBtn);
      actions.appendChild(menu);
    }
    bubble.appendChild(actions);
    if (avatar) wrap.appendChild(avatar);
  }
  wrap.appendChild(bubble);
  // Now that bubble and its children exist, apply final text/visibility updates
  updateEl(wrap);
  messagesEl.appendChild(wrap);
  // Register mentions after render so badge updates immediately
  registerMentionIfTarget(doc);
  // Register reply notifications (when someone replies to your message)
  registerReplyIfTarget(doc);
  return wrap;
}

function updateQuote(el, replyId) {
  const ref = replyId ? messageById.get(replyId) : null;
  if (ref) {
    const snippet = String(ref.content || '').slice(0, 80);
    el.innerHTML = `<strong>${ref.username || 'Unknown'}</strong>: ${snippet}${snippet.length >= 80 ? '…' : ''}`;
  } else {
    el.textContent = 'Replying to a message';
  }
}

function setReplyTarget(doc) {
  replyTarget = doc;
  const snippet = String(doc.content || '').slice(0, 80);
  replyTextEl.textContent = `${doc.username || 'Unknown'}: ${snippet}${snippet.length >= 80 ? '…' : ''}`;
  replyBar.classList.remove('hidden');
  messageInput.focus();
}

replyCancelBtn?.addEventListener('click', () => {
  replyTarget = null;
  replyTextEl.textContent = '';
  replyBar.classList.add('hidden');
});

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Auth Logic
let isSignup = false;
function setAuthMode(signup) {
  isSignup = signup;
  authSubmitButton.textContent = signup ? 'Signup' : 'Login';
  switchModeButton.textContent = signup ? 'Switch to Login' : 'Switch to Signup';
  // Show Name only for signup
  try {
    if (nameField) nameField.style.display = signup ? '' : 'none';
    if (nameInput) nameInput.required = signup;
    // Show forgot password only in login mode
    if (forgotButton) forgotButton.style.display = signup ? 'none' : '';
  } catch (_) {}
}
setAuthMode(false);

switchModeButton.addEventListener('click', () => setAuthMode(!isSignup));

function setupPasswordToggle(toggleEl, inputEl) {
  try {
    if (!toggleEl || !inputEl) return;
    const update = () => {
      const showing = inputEl.type === 'text';
      toggleEl.setAttribute('aria-pressed', String(showing));
      toggleEl.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      toggleEl.title = showing ? 'Hide password' : 'Show password';
    };
    update();
    toggleEl.addEventListener('click', () => {
      inputEl.type = inputEl.type === 'password' ? 'text' : 'password';
      update();
      try { inputEl.focus({ preventScroll: true }); } catch (_) { inputEl.focus(); }
    });
  } catch (_) {}
}

try {
  const passwordToggleEl = document.getElementById('passwordToggle');
  const newPasswordToggleEl = document.getElementById('newPasswordToggle');
  const confirmPasswordToggleEl = document.getElementById('confirmPasswordToggle');
  setupPasswordToggle(passwordToggleEl, passwordInput);
  setupPasswordToggle(newPasswordToggleEl, newPasswordInput);
  setupPasswordToggle(confirmPasswordToggleEl, confirmPasswordInput);
} catch (_) {}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = (nameInput?.value || '').trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (isRateLimited()) {
    toast('Please wait a few seconds before retrying.', 'error');
    return;
  }
  if (!email || !password) {
    toast('Email and password are required', 'error');
    return;
  }
  if (isSignup && !name) {
    toast('Please enter your name for signup', 'error');
    return;
  }
  showLoading(true);
  authSubmitButton.disabled = true;
  try {
    // Aggressively clear any existing session before creating a new one
    clearLocalAppwriteSession();
    try { await account.deleteSessions?.(); } catch (_) {}
    try { await account.deleteSession('current'); } catch (_) {}
    currentUser = null;
    if (isSignup) {
      await account.create(Appwrite.ID.unique(), email, password, name);
      // Automatically log in
      try {
        await account.createEmailPasswordSession(email, password);
      } catch (errCreate) {
        const msg = String(errCreate?.message || '').toLowerCase();
        if (msg.includes('session is active') || msg.includes('missing scopes') || errCreate?.code === 401) {
          clearLocalAppwriteSession();
          try { await account.deleteSession('current'); } catch (_) {}
          await account.createEmailPasswordSession(email, password);
        } else {
          throw errCreate;
        }
      }
      // Send verification email for new accounts
      try {
        const verifyUrl = `${location.origin}${location.pathname}?verify=1`;
        await account.createVerification(verifyUrl);
        toast('Verification email sent. Please check your inbox.', 'success');
      } catch (verr) {
        console.warn('Create verification error', verr);
      }
    } else {
      // Create email session with retry if an active session blocks creation
      try {
        await account.createEmailPasswordSession(email, password);
      } catch (errCreate) {
        const msg = String(errCreate?.message || '').toLowerCase();
        if (msg.includes('session is active') || msg.includes('missing scopes') || errCreate?.code === 401) {
          clearLocalAppwriteSession();
          try { await account.deleteSession('current'); } catch (_) {}
          await account.createEmailPasswordSession(email, password);
        } else {
          throw errCreate;
        }
      }
    }
    await afterLogin();
  } catch (err) {
    console.error('Auth error', err);
    const msg = String(err?.message || '').toLowerCase();
    if (err?.code === 429 || msg.includes('rate limit')) {
      startRateLimitCooldown(5000, err?.message || 'Rate limit exceeded. Try again soon.');
    } else {
      toast(err?.message || 'Authentication failed', 'error');
    }
  } finally {
    authSubmitButton.disabled = false;
    showLoading(false);
  }
});

// Optional auth: continue as guest (anonymous session) — disabled
guestButton?.addEventListener('click', async () => {
  if (isRateLimited()) {
    toast('Please wait a few seconds before retrying.', 'error');
    return;
  }
  showLoading(true);
  // Disabled: guest login removed
  guestButton && (guestButton.disabled = true);
  try {
    // If a session already exists, reuse it; otherwise create anonymous
    try { currentUser = await account.get(); } catch (_) {}
    if (!currentUser) {
      // Try to create anonymous session, retry after deleting any active session
      try {
        await account.createAnonymousSession();
      } catch (errAnon) {
        const msg = String(errAnon?.message || '').toLowerCase();
        if (msg.includes('session is active')) {
          clearLocalAppwriteSession();
          try { await account.deleteSession('current'); } catch (_) {}
          await account.createAnonymousSession();
        } else {
          throw errAnon;
        }
      }
      currentUser = await account.get();
    }
    await afterLogin();
  } catch (err) {
    console.error('Anonymous session error', err);
    const msg = String(err?.message || '').toLowerCase();
    if (err?.code === 429 || msg.includes('rate limit')) {
      startRateLimitCooldown(5000, err?.message || 'Rate limit exceeded. Try again soon.');
    } else {
      toast(err?.message || 'Failed to start guest session', 'error');
    }
  } finally {
    guestButton && (guestButton.disabled = false);
    showLoading(false);
  }
});

// Reset Session: aggressively clear local session and end current Appwrite session
resetSessionButton?.addEventListener('click', async () => {
  try {
    showLoading(true);
    clearLocalAppwriteSession();
    try { await account.deleteSessions?.(); } catch (_) {}
    try { await account.deleteSession('current'); } catch (_) {}
    currentUser = null;
    toast('Session reset. Please try login again.');
  } catch (e) {
    console.error('Reset session failed', e);
    toast('Reset session encountered an issue. Try again or use Incognito.', 'error');
  } finally {
    showLoading(false);
  }
});

logoutButton.addEventListener('click', async () => {
  // Close menu immediately for responsive feel
  try { profileMenu.classList.remove('open'); profileButton.setAttribute('aria-expanded', 'false'); } catch (_) {}
  showLoading(true);
  logoutButton.disabled = true;
  const wasGuest = isGuest();
  const inChat = hasEnteredChat === true;
  try {
    // Only leave the chat (and post event) if we are currently in chat
    if (inChat) {
      await leaveChat();
    } else {
      // Not in chat: just mark presence offline silently
      try { await upsertPresence('offline'); } catch (_) {}
    }
    // If guest timer still has time, keep session and let timer expire to clean DB
    if (wasGuest && !isGuestExpired()) {
      try { ensureGuestExpireAt(); } catch (_) {}
      try { startGuestTimerIfNeeded(); } catch (_) {}
      // Mark presence offline but do not delete until expiry
      try { await upsertPresence('offline'); } catch (_) {}
    } else {
      // End session and aggressively clear local/app sessions
      try { await upsertPresence('offline'); } catch (_) {}
      try { clearLocalAppwriteSession(); } catch (_) {}
      try { await account.deleteSessions?.(); } catch (_) {}
      try { await account.deleteSession('current'); } catch (_) {}
    }
  } catch (err) {
    console.warn('Logout error', err);
  } finally {
    currentUser = null;
    profileName.textContent = 'Guest';
    profileEmail.textContent = '';
    try { logoutButton.style.display = 'none'; } catch (_) {}
    try { profileButton.style.display = 'none'; } catch (_) {}
    try { loginNavButton.style.display = ''; } catch (_) {}
    try { mentionsButton.style.display = 'none'; } catch (_) {}
    try { mentionsBadge.hidden = true; } catch (_) {}
    try { mentionsMenu.classList.remove('open'); } catch (_) {}
    try { profileMenu.classList.remove('open'); profileButton.setAttribute('aria-expanded','false'); } catch (_) {}
    logoutButton.disabled = false;
    showLoading(false);
    showView('landing');
    // Continue showing the timer for guests whose countdown is still active
    try { if (wasGuest) startGuestTimerIfNeeded(); } catch (_) {}
  }
});

profileButton.addEventListener('click', () => {
  if (!currentUser) return; // No dropdown when logged out
  const isOpen = profileMenu.classList.toggle('open');
  profileButton.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) positionProfileMenu();
});

loginNavButton?.addEventListener('click', () => {
  // Login from navbar should return to landing after auth
  loginIntent = 'landing';
  showView('auth');
  setAuthMode(false);
});

// Auth back button: return to landing view and reset auth forms
authBackButton?.addEventListener('click', () => {
  try {
    // Ensure default auth form is visible when returning later
    authForm.classList.remove('hidden');
    resetForm.classList.add('hidden');
    setAuthMode(false);
  } catch (_) {}
  showView('landing');
});

document.addEventListener('click', (e) => {
  if (!profileMenu.contains(e.target) && !profileButton.contains(e.target)) {
    profileMenu.classList.remove('open');
    profileButton.setAttribute('aria-expanded', 'false');
  }
});

window.addEventListener('resize', () => {
  if (profileMenu.classList.contains('open')) positionProfileMenu();
  if (mentionsMenu.classList.contains('open')) positionMentionsMenu();
});
window.addEventListener('scroll', () => {
  if (profileMenu.classList.contains('open')) positionProfileMenu();
  if (mentionsMenu.classList.contains('open')) positionMentionsMenu();
}, { passive: true });

// Chat Logic
async function afterLogin() {
  try {
    currentUser = await account.get();
    // Persist guest id to allow cleanup even after logout
    try {
      if (isGuest() && currentUser?.$id) {
        localStorage.setItem(GUEST_USER_ID_KEY, currentUser.$id);
      }
    } catch (_) {}
    // Persist admin user ID for reliable badge detection
    if (String(currentUser?.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      ADMIN_USER_ID = currentUser.$id;
      try { localStorage.setItem('solchat_admin_user_id', ADMIN_USER_ID); } catch (_) {}
    }
    const display = getDisplayName(currentUser);
    setNameWithBadge(profileName, display, currentUser);
    profileEmail.textContent = currentUser.email || '';
    try { logoutButton.style.display = ''; } catch (_) {}
    try { profileButton.style.display = ''; } catch (_) {}
    try { loginNavButton.style.display = 'none'; } catch (_) {}
    try { mentionsButton.style.display = 'inline-flex'; } catch (_) {}
    try { updateMentionsBadge(); } catch (_) {}
    enforceVerified();
    enforceBanUI();
    // Route based on intent
    if (loginIntent === 'chat') {
      await enterChat();
    } else {
      showView('landing');
      initLanding();
    }
    // Reset intent after handling
    loginIntent = 'landing';
  } catch (err) {
    console.error('Post-login error', err);
    toast('Failed to load user or messages', 'error');
  }
}

async function enterChat() {
  try {
    if (hasEnteredChat || enterChatInProgress) return; // Prevent double-enter on rapid retries
    enterChatInProgress = true;
    showView('chat');
    enforceVerified();
    enforceBanUI();
    await loadMessages();
    startRealtime();
    await upsertPresence('online');
    startPresenceHeartbeat();
    startPresenceRealtime();
    startGuestTimerIfNeeded();
    // Periodically refresh the online users panel to keep it up-to-date
    try { clearInterval(onlineRefreshIntervalId); } catch (_) {}
    onlineRefreshIntervalId = setInterval(() => { try { refreshOnlineUsers(); } catch (_) {} }, 40000);
    // Try to fetch total registered users from Auth; ignore if not accessible
    try { await refreshTotalUsersFromAuth(); } catch (_) {}
    // Refresh the online users list, but do not block join event if it fails
    try { await refreshOnlineUsers(); } catch (e) { console.warn('Refresh online users failed', e); }
    // Post the join/rejoin event robustly so it always appears when re-entering
    try {
      const name = getDisplayName(currentUser);
      // Always show "joined" to reduce noise
      await postEvent(`${name} has joined the chat`);
      // Reset rejoin marker after posting
      lastLeaveAt = null;
    } catch (e) {
      console.warn('Join event post failed', e);
    }
    // Ensure input is mounted appropriately after content loads
    updateInputMount();
    hasEnteredChat = true;
  } catch (err) {
    console.error('Enter chat error', err);
    toast('Failed to enter chat', 'error');
  } finally {
    enterChatInProgress = false;
  }
}

async function leaveChat() {
  try {
    if (currentUser) {
      const name = getDisplayName(currentUser);
      await postEvent(`${name} has left the chat`);
      await upsertPresence('offline');
      // Record leave time to enable rejoin message on next enter
      try { lastLeaveAt = new Date().toISOString(); } catch (_) {}
    }
  } catch (err) {
    console.warn('Leave event/presence error', err);
  }
  // Stop guest timer to avoid auto-logout after leaving the room
  try { clearInterval(guestTimerIntervalId); } catch (_) {}
  try {
    guestTimerEl?.classList.add('hidden');
    if (guestCountdownEl) guestCountdownEl.textContent = '15:00';
    if (guestTimerBarEl) guestTimerBarEl.style.width = '100%';
  } catch (_) {}
  try { clearInterval(presenceHeartbeatId); } catch (_) {}
  try { clearInterval(onlineRefreshIntervalId); } catch (_) {}
  try { unsubscribeRealtime?.(); } catch (_) {}
  try { unsubscribePresenceRealtime?.(); } catch (_) {}
  hasEnteredChat = false;
  // Perform a hard refresh to fully reset landing state before showing it
  try {
    // Ensure URL will not trigger auto-join on reload
    try {
      const url = new URL(window.location.href);
      // Remove explicit chat auto-join flags
      if (url.searchParams.get('view') === 'chat') url.searchParams.delete('view');
      url.searchParams.delete('autojoin');
      // Force landing hash so boot picks landing instead of chat
      url.hash = 'landing';
      history.replaceState({}, document.title, url.toString());
    } catch (_) {}
    // Use location.reload to avoid stale UI state requiring manual refresh
    window.location.reload();
    return; // Prevent further execution after triggering reload
  } catch (_) {
    // Fallback: soft reinit if reload fails
    showView('landing');
    try {
      const tvQuoteContainer = document.getElementById('tvQuoteContainer');
      const tvNewsContainer = document.getElementById('tvNewsContainer');
      if (tvQuoteContainer) tvQuoteContainer.innerHTML = '';
      if (tvNewsContainer) tvNewsContainer.innerHTML = '';
      if (solNewsListEl) solNewsListEl.innerHTML = '';
      if (solPriceEl) solPriceEl.textContent = '';
      if (solPriceChangeEl) solPriceChangeEl.textContent = '';
      if (solChartEl) solChartEl.innerHTML = '';
      chartInitialized = false;
      initLanding();
    } catch (_) {}
  }
}

async function loadMessages() {
  showLoading(true);
  try {
    let res;
    try {
      // Preferred: ordered by timestamp via index
      res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, [
        Appwrite.Query.orderAsc('timestamp'),
        Appwrite.Query.limit(100)
      ]);
    } catch (orderErr) {
      // Fallback: fetch without ordering, sort on client
      res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, [
        Appwrite.Query.limit(100)
      ]);
      res.documents.sort((a, b) => {
        const ta = new Date(a.timestamp || a.$createdAt).getTime();
        const tb = new Date(b.timestamp || b.$createdAt).getTime();
        return ta - tb;
      });
    }
    messagesEl.innerHTML = '';
    res.documents.forEach(renderMessage);
    try { updatePinnedBar(); } catch (_) {}
    scrollToBottom();
    try {
      const last = res.documents[res.documents.length - 1];
      if (last) {
        // Presence upsert only writes allowed schema fields; rely on updatedAt for seen-by
        await upsertPresence('online');
      }
    } catch (_) {}
  } catch (err) {
    console.error('Load messages error', err);
    toast('Could not load messages. Ensure DB & collection exist.', 'error');
  } finally {
    showLoading(false);
  }
}

function startRealtime() {
  const channel = `databases.${DATABASE_ID}.collections.${COLLECTION_ID}.documents`;
  try {
    unsubscribeRealtime?.();
  } catch (_) {}
  unsubscribeRealtime = subscribe(channel, (event) => {
    try {
      const events = event?.events || [];
      const payload = event?.payload || event?.$payload || null;
      const isCreate = Array.isArray(events) ? events.some((e) => e.endsWith('.create')) : false;
      const isUpdate = Array.isArray(events) ? events.some((e) => e.endsWith('.update')) : false;
      const isDelete = Array.isArray(events) ? events.some((e) => e.endsWith('.delete')) : false;
      if (payload && (isCreate || isUpdate)) {
        // Handle ban/unban events using only the first line of content
        const c = String(payload?.content || '');
        const firstLine = c.trim().split('\n')[0];
        if (firstLine.startsWith('[BAN]')) {
          const m = firstLine.match(/^\[BAN\]\s+key=(.+?)\s+name=(.+?)\s+until=(.+?)(?:\s+by=(.+))?$/);
          if (m) {
            const [, key, name, until, by] = m;
            bans[key] = { key, name, until, by };
            saveBans();
            // If current user is affected, enforce immediately
            const myKey = getBanKeyFromUser(currentUser || {});
            if (key === myKey) enforceBanUI();
          }
        }
        // Handle unban events
        if (firstLine.startsWith('[UNBAN]')) {
          const m = firstLine.match(/^\[UNBAN\]\s+key=(.+?)\s+name=(.+?)(?:\s+by=(.+))?$/);
          if (m) {
            const [, key] = m;
            try { delete bans[key]; saveBans(); } catch (_) {}
            const myKey = getBanKeyFromUser(currentUser || {});
            if (key === myKey) enforceBanUI();
          }
        }
        // Handle pin/unpin events
        if (firstLine.startsWith('[PIN]')) {
          const m = firstLine.match(/^\[PIN\]\s+id=(.+?)(?:\s+by=(.+))?$/);
          if (m) {
            const [, id] = m;
            pinnedMessageIds.add(id);
            try { updatePinnedBar(); } catch (_) {}
            try { applyPinnedStateUIForId(id, true); } catch (_) {}
          }
        }
        if (firstLine.startsWith('[UNPIN]')) {
          const m = firstLine.match(/^\[UNPIN\]\s+id=(.+?)(?:\s+by=(.+))?$/);
          if (m) {
            const [, id] = m;
            try { pinnedMessageIds.delete(id); } catch (_) {}
            try { updatePinnedBar(); } catch (_) {}
            try { applyPinnedStateUIForId(id, false); } catch (_) {}
          }
        }
        // Dedup by $id: update if exists, otherwise append
        renderMessage(payload);
        // Also register mentions from realtime events
        registerMentionIfTarget(payload);
        scrollToBottom();
      }
      if (isDelete) {
        // For simplicity, just reload list on deletes
        loadMessages();
      }
    } catch (err) {
      console.error('Realtime handler error', err);
    }
  });
}

// Avatar helpers
function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] || '';
  const second = parts.length > 1 ? parts[1][0] || '' : (parts[0][1] || '');
  return (first + second).toUpperCase();
}

function colorFromSeed(seed) {
  const s = String(seed || 'seed');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 50%)`;
}

function setAvatar(el, name, seed) {
  // Use image with color tint per user
  el.textContent = '';
  const color = colorFromSeed(seed || name);
  el.style.backgroundColor = color;
  // Ensure the image is applied (CSS sets it, but in case of runtime elements)
  el.style.backgroundImage = `url('user.png')`;
  el.style.backgroundSize = '70%';
  el.style.backgroundPosition = 'center';
  el.style.backgroundRepeat = 'no-repeat';
}

// Presence logic
async function upsertPresence(status = 'online') {
  // Skip presence writes when offline to avoid noisy network errors
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Attempt presence writes even if reachability probe fails; rely on SDK errors
  if (!currentUser?.$id) return;
  try {
    if (isGuestExpired()) return;
  } catch (_) {}
  const now = new Date().toISOString();
  const userId = currentUser.$id;
  const username = getDisplayName(currentUser);
  const avatar = initialsFromName(username);
  const payload = { userId, username, avatar, status, updatedAt: now };
  // Update-first strategy to avoid create 409 noise; fall back to create
  try {
    await databases.updateDocument(
      DATABASE_ID,
      PRESENCE_COLLECTION_ID,
      userId,
      payload,
      [
        Appwrite.Permission.read(Appwrite.Role.any()),
        Appwrite.Permission.update(Appwrite.Role.user(userId)),
        Appwrite.Permission.delete(Appwrite.Role.user(userId)),
      ]
    );
  } catch (updateErr) {
    if (updateErr?.code === 404) {
      try {
        await databases.createDocument(
          DATABASE_ID,
          PRESENCE_COLLECTION_ID,
          userId,
          payload,
          [
            Appwrite.Permission.read(Appwrite.Role.any()),
            Appwrite.Permission.update(Appwrite.Role.user(userId)),
            Appwrite.Permission.delete(Appwrite.Role.user(userId)),
          ]
        );
      } catch (createErr) {
        // Ignore conflict if document already exists
        if (createErr?.code !== 409) {
          console.error('Presence create error', createErr);
        }
      }
    } else if (updateErr?.code === 409) {
      // Ignore conflicts silently
      return;
    } else if (updateErr?.code === 400) {
      // Suppress invalid attribute noise (e.g., server-side schema mismatch)
      console.warn('Presence update skipped due to schema validation', updateErr?.message || updateErr);
      return;
    } else {
      console.error('Presence update error', updateErr);
    }
  }
}

function startPresenceHeartbeat() {
  try { clearInterval(presenceHeartbeatId); } catch (_) {}
  presenceHeartbeatId = setInterval(() => {
    // Avoid heartbeats when offline
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (isGuestExpired()) {
      console.log('Presence heartbeat detected guest expiry, calling handleGuestExpiry');
      try { clearInterval(presenceHeartbeatId); } catch (_) {}
      handleGuestExpiry();
    } else {
      upsertPresence('online');
    }
  }, 25000);
}

// Periodic cleanup of expired guests (runs every 2 minutes)
let cleanupIntervalId = null;
function startPeriodicCleanup() {
  // Disabled per request: guest cleanup is turned off
  try { clearInterval(cleanupIntervalId); } catch (_) {}
  console.log('Guest cleanup disabled: periodic scheduler is off');
}

function startPresenceRealtime() {
  const channel = `databases.${DATABASE_ID}.collections.${PRESENCE_COLLECTION_ID}.documents`;
  try { unsubscribePresenceRealtime?.(); } catch (_) {}
  unsubscribePresenceRealtime = subscribe(channel, async (event) => {
    try {
      const events = event?.events || [];
      const hasChange = Array.isArray(events) && events.some((e) => /\.(create|update|delete)$/.test(e));
      if (hasChange) await refreshOnlineUsers();
    } catch (err) {
      console.error('Presence realtime handler error', err);
    }
  });
  // Immediately populate the online users panel so it isn’t empty until the first event
  try { refreshOnlineUsers(); } catch (_) {}
}

function isGuest() {
  return !currentUser?.email;
}

function getGuestExpireKey() {
  // Use stored guest id when logged out so timer continues
  const stored = (() => { try { return localStorage.getItem(GUEST_USER_ID_KEY) || null; } catch (_) { return null; } })();
  const uid = currentUser?.$id || stored || 'guest';
  return `solchat_guest_expire_at_${uid}`;
}

function getGuestExpireAt() {
  try {
    const val = localStorage.getItem(getGuestExpireKey());
    const num = val ? parseInt(val, 10) : null;
    return Number.isFinite(num) ? num : null;
  } catch (_) {
    return null;
  }
}

function ensureGuestExpireAt() {
  let at = getGuestExpireAt();
  if (!at) {
    at = Date.now() + 15 * 60 * 1000;
    try { localStorage.setItem(getGuestExpireKey(), String(at)); } catch (_) {}
  }
  return at;
}

function isGuestExpired() {
  const at = getGuestExpireAt();
  return !!(at && Date.now() >= at);
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startGuestTimerIfNeeded() {
  try { clearInterval(guestTimerIntervalId); } catch (_) {}
  guestTimerIntervalId = null;
  guestExpired = false;
  if (!isGuest()) {
    try { guestTimerEl?.classList.add('hidden'); } catch (_) {}
    return;
  }
  const expireAt = ensureGuestExpireAt();
  try { guestTimerEl?.classList.remove('hidden'); } catch (_) {}
  const totalMs = Math.max(0, expireAt - Date.now());
  const tick = () => {
    const remaining = expireAt - Date.now();
    if (remaining <= 0) {
      console.log('Guest timer expired, calling handleGuestExpiry');
      handleGuestExpiry();
    } else {
      const pct = Math.max(0, Math.min(100, Math.floor((remaining / (15 * 60 * 1000)) * 100)));
      try {
        if (guestCountdownEl) guestCountdownEl.textContent = `${formatCountdown(remaining)}`;
        if (guestTimerBarEl) guestTimerBarEl.style.width = `${pct}%`;
        if (guestTimerEl) {
          guestTimerEl.classList.remove('guest-timer--warn','guest-timer--danger');
          if (remaining <= 2 * 60 * 1000) guestTimerEl.classList.add('guest-timer--danger');
          else if (remaining <= 5 * 60 * 1000) guestTimerEl.classList.add('guest-timer--warn');
        }
      } catch (_) {}
    }
  };
  tick();
  guestTimerIntervalId = setInterval(tick, 1000);
}

async function handleGuestExpiry() {
  console.log('handleGuestExpiry called');
  guestExpired = true;
  try { clearInterval(guestTimerIntervalId); } catch (_) {}
  try {
    guestTimerEl?.classList.add('hidden');
    if (guestCountdownEl) guestCountdownEl.textContent = '00:00';
    if (guestTimerBarEl) guestTimerBarEl.style.width = '0%';
  } catch (_) {}
  // Do not delete presence or user; simply mark presence idle/offline and keep session
  try { await upsertPresence('offline'); } catch (_) {}
  try { toast('Guest timer expired. Cleanup disabled for now.', 'info'); } catch (_) {}
}

async function cleanupExpiredGuests(presenceDocuments) {
  if (!Array.isArray(presenceDocuments)) return;
  
  const now = Date.now();
  const expiredGuests = [];
  
  for (const doc of presenceDocuments) {
    const userId = doc.userId || doc.$id;
    if (!userId) continue;
    
    // Check if this is a guest user by looking for stored expiry time
    const guestExpireKey = `solchat_guest_expire_at_${userId}`;
    try {
      const expireAtStr = localStorage.getItem(guestExpireKey);
      if (expireAtStr) {
        const expireAt = parseInt(expireAtStr, 10);
        if (Number.isFinite(expireAt) && now >= expireAt) {
          console.log('Found expired guest user:', userId, 'expired at:', new Date(expireAt));
          expiredGuests.push({ userId, doc, expireKey: guestExpireKey });
        }
      }
    } catch (_) {}
  }
  
  // Delete expired guest presence documents
  for (const { userId, doc, expireKey } of expiredGuests) {
    try {
      console.log('Deleting expired guest presence:', userId);
      await databases.deleteDocument(DATABASE_ID, PRESENCE_COLLECTION_ID, userId);
      console.log('Successfully deleted expired guest presence:', userId);
      
      // Clean up localStorage
      try { localStorage.removeItem(expireKey); } catch (_) {}
      
      // Try to delete the guest auth user if possible
      try {
        if (usersApi) {
          await usersApi.delete(userId);
          console.log('Successfully deleted expired guest user:', userId);
        }
      } catch (userErr) {
        console.log('Could not delete guest user (may require server privileges):', userErr.message);
      }
    } catch (err) {
      console.error('Failed to delete expired guest presence:', userId, err);
    }
  }
  
  if (expiredGuests.length > 0) {
    console.log(`Cleaned up ${expiredGuests.length} expired guest users`);
  }
}

async function refreshOnlineUsers() {
  try {
    // Skip online list refresh when offline
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let res;
    try {
      // Preferred: server-side sort by updatedAt (requires index)
      res = await databases.listDocuments(DATABASE_ID, PRESENCE_COLLECTION_ID, [
        Appwrite.Query.orderDesc('updatedAt'),
        Appwrite.Query.limit(100)
      ]);
    } catch (orderErr) {
      // Fallback: fetch without ordering and sort on client to avoid 400s
      res = await databases.listDocuments(DATABASE_ID, PRESENCE_COLLECTION_ID, [
        Appwrite.Query.limit(100)
      ]);
      try {
        res.documents.sort((a, b) => {
          const ta = new Date(a.updatedAt || a.$updatedAt || a.$createdAt || 0).getTime();
          const tb = new Date(b.updatedAt || b.$updatedAt || b.$createdAt || 0).getTime();
          return tb - ta; // desc
        });
      } catch (_) {}
    }
    const now = Date.now();
  // Cache full presence docs for Seen-by tooltips
  presenceDocs = Array.isArray(res.documents) ? res.documents.slice() : [];
  
  // Guest cleanup disabled: do not delete expired guests here
    
    // Consider users active if seen in the last 5 minutes; treat stale-but-online as idle
    const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
    const onlineOrIdle = res.documents.filter((d) => String(d.status || '').toLowerCase() !== 'offline');
    let active = onlineOrIdle.filter((d) => {
      const t = new Date(d.updatedAt || d.$updatedAt || d.$createdAt || Date.now()).getTime();
      return now - t < ACTIVE_WINDOW_MS;
    });
    const presenceTotal = typeof res.total === 'number' ? res.total : (res.documents?.length || 0);
    const total = typeof totalUsersCount === 'number' ? totalUsersCount : presenceTotal;
    // Pin admin (Mitto) to the top when online
    const pinned = active.filter((d) => isAdmin(d));
    const others = active.filter((d) => !isAdmin(d));
    let ordered = [...pinned, ...others];
    // Fallback: if no active users are found, show the current user if available
    if ((!ordered || ordered.length === 0) && currentUser) {
      const selfDoc = {
        userId: currentUser.$id,
        username: getDisplayName(currentUser),
        avatar: initialsFromName(getDisplayName(currentUser)),
        status: 'online',
      };
      ordered = [selfDoc];
    }
    activeUsers = ordered.map(d => ({ userId: d.userId || d.$id, username: d.username || 'Unknown', avatar: d.avatar || initialsFromName(d.username || 'Unknown') }));
    usersListEl.innerHTML = '';
    ordered.forEach((d) => usersListEl.appendChild(renderUserItem(d)));
    try {
      // Show online count out of total presence
      if (usersTitleEl) usersTitleEl.textContent = `Online (${ordered.length}/${presenceTotal})`;
    } catch (_) {}
    // After presence docs refresh, update all seen counters live
    try { refreshSeenCounters(); } catch (_) {}
  } catch (err) {
    console.error('Refresh users error', err);
    // Hard fallback: render current user to avoid empty UI
    try {
      usersListEl.innerHTML = '';
      if (currentUser) {
        const selfDoc = {
          userId: currentUser.$id,
          username: getDisplayName(currentUser),
          avatar: initialsFromName(getDisplayName(currentUser)),
          status: 'online',
        };
        usersListEl.appendChild(renderUserItem(selfDoc));
        if (usersTitleEl) usersTitleEl.textContent = 'Online (1/1)';
      } else {
        if (usersTitleEl) usersTitleEl.textContent = 'Online (0/0)';
      }
    } catch (_) {}
  }
}

// Live update of seen counters for messages and pinned banner
function refreshSeenCounters() {
  try {
    // Update counts on all non-event messages
    const msgEls = messagesEl.querySelectorAll('.msg[data-doc-id]');
    msgEls.forEach((wrap) => {
      try {
        const docId = wrap.getAttribute('data-doc-id');
        const doc = docId ? messageById.get(docId) : null;
        if (!doc || isEventMessage(doc)) return;
        const msgTs = new Date(doc.timestamp || doc.$createdAt || Date.now()).getTime();
        const count = (presenceDocs || []).filter((d) => {
          const tsStr = d.lastSeenMessageTs || d.lastSeenAt || d.updatedAt || d.$updatedAt || d.$createdAt;
          const t = tsStr ? new Date(tsStr).getTime() : 0;
          return t >= msgTs;
        }).length;
        // Compact formatter
        let compact = '';
        if (count >= 1000000000) compact = `${Math.floor(count / 1000000000)}B`;
        else if (count >= 1000000) compact = `${Math.floor(count / 1000000)}M`;
        else if (count >= 1000) compact = `${Math.floor(count / 1000)}k`;
        else compact = `${count}`;
        const btn = wrap.querySelector('.msg__action--seen');
        if (btn) {
          const span = btn.querySelector('.seen__count');
          if (span) span.textContent = compact;
          btn.title = `${count} viewers`;
          btn.setAttribute('aria-label', `${count} viewers`);
        }
      } catch (_) {}
    });
    // Update the pinned banner view counter if present
    const pinnedCard = document.querySelector('.pinned-card[data-doc-id]');
    if (pinnedCard) {
      const pinnedId = pinnedCard.getAttribute('data-doc-id');
      const doc = pinnedId ? messageById.get(pinnedId) : null;
      if (doc) {
        const msgTs = new Date(doc.timestamp || doc.$createdAt || Date.now()).getTime();
        const count = (presenceDocs || []).filter((d) => {
          const tsStr = d.lastSeenMessageTs || d.lastSeenAt || d.updatedAt || d.$updatedAt || d.$createdAt;
          const t = tsStr ? new Date(tsStr).getTime() : 0;
          return t >= msgTs;
        }).length;
        let compact = '';
        if (count >= 1000000000) compact = `${Math.floor(count / 1000000000)}B`;
        else if (count >= 1000000) compact = `${Math.floor(count / 1000000)}M`;
        else if (count >= 1000) compact = `${Math.floor(count / 1000)}k`;
        else compact = `${count}`;
        const btn = pinnedCard.querySelector('.pinned__views');
        if (btn) {
          const span = btn.querySelector('.seen__count');
          if (span) span.textContent = compact;
          btn.title = `${count} viewers`;
          btn.setAttribute('aria-label', `${count} viewers`);
        }
      }
    }
  } catch (_) {}
}

function renderUserItem(doc) {
  const item = document.createElement('div');
  item.className = 'user';
  const avatar = document.createElement('div');
  avatar.className = 'user__avatar';
  setAvatar(avatar, doc.username || 'Unknown', doc.userId || doc.$id);
  const badge = document.createElement('span');
  badge.className = 'user__badge user__badge--online';
  const name = document.createElement('div');
  name.className = 'user__name';
  setNameWithBadge(name, doc.username || 'Unknown', doc);
  // Ensure badge positions relative to avatar
  avatar.appendChild(badge);
  item.appendChild(avatar);
  item.appendChild(name);
  return item;
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const banInfo = isBannedUser(currentUser);
  if (banInfo) {
    const untilText = banInfo.until === 'forever' ? 'Forever' : new Date(banInfo.until).toLocaleString();
    toast(`You are banned until ${untilText}`, 'error');
    enforceBanUI();
    return;
  }
  // Allow messaging even if logged-in user is not verified
  const text = (messageInput.value || '').trim();
  if (!text) {
    toast("Message can't be empty", 'error');
    return;
  }
  const ts = new Date().toISOString();
  const username = getDisplayName(currentUser);
  const userId = currentUser?.$id || 'unknown';
  messageInput.value = '';
  try {
    const created = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_ID,
      Appwrite.ID.unique(),
      { userId, username, content: text, timestamp: ts, replyTo: replyTarget?.$id || null },
      [
        Appwrite.Permission.read(Appwrite.Role.any()),
        Appwrite.Permission.update(Appwrite.Role.user(userId)),
        Appwrite.Permission.delete(Appwrite.Role.user(userId)),
      ]
    );
    // Render the created document using its $id so realtime doesn’t duplicate
    renderMessage(created);
    scrollToBottom();
    // Clear reply state
    replyTarget = null;
    replyTextEl.textContent = '';
    replyBar.classList.add('hidden');
  } catch (err) {
    console.error('Send message error', err);
    toast('Failed to send message', 'error');
  }
});

// Leave button in chat
leaveChatButton?.addEventListener('click', () => {
  leaveChat();
});

// Event announcements
function isEventMessage(doc) {
  const c = String(doc?.content || '');
  // Normalize to first line and trim leading spaces to be tolerant of formatting
  const firstLine = c.trimStart().split('\n')[0];
  const joinedLeft = / has (joined|rejoined|left) the chat$/.test(firstLine) && !doc.replyTo;
  const isBan = firstLine.startsWith('[BAN]');
  const isUnban = firstLine.startsWith('[UNBAN]');
  const isPin = firstLine.startsWith('[PIN]');
  const isUnpin = firstLine.startsWith('[UNPIN]');
  return joinedLeft || isBan || isUnban || isPin || isUnpin;
}

async function postEvent(text) {
  const ts = new Date().toISOString();
  const username = getDisplayName(currentUser);
  const userId = currentUser?.$id || 'unknown';

  // Optimistic render so the join/leave appears instantly
  let el = null;
  try {
    const localDoc = {
      $id: `local-${Date.now()}`,
      userId,
      username,
      content: text,
      timestamp: ts,
      replyTo: null,
    };
    el = renderMessage(localDoc);
    scrollToBottom();
  } catch (renderErr) {
    console.warn('Optimistic event render failed', renderErr);
  }

  // Persist to server and sync the optimistic bubble to avoid duplicates
  try {
    const created = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_ID,
      Appwrite.ID.unique(),
      { userId, username, content: text, timestamp: ts, replyTo: null },
      [
        Appwrite.Permission.read(Appwrite.Role.any()),
        Appwrite.Permission.update(Appwrite.Role.user(userId)),
        Appwrite.Permission.delete(Appwrite.Role.user(userId)),
      ]
    );

    // Ensure required fields exist for rendering
    created.content = created.content || text;
    created.timestamp = created.timestamp || ts;
    created.userId = created.userId || userId;
    created.username = created.username || username;
    created.replyTo = created.replyTo ?? null;

    // Convert optimistic bubble to the real doc-id so realtime won’t duplicate
    try { if (el) el.setAttribute('data-doc-id', created.$id); } catch (_) {}
    renderMessage(created);
    scrollToBottom();
  } catch (err) {
    console.warn('Persisting event failed; keeping optimistic bubble', err);
    // Leave optimistic render as-is
  }
}

// Reconnect logic
window.addEventListener('online', () => {
  if (currentUser) startRealtime();
  if (currentUser) {
    upsertPresence('online');
    startPresenceRealtime();
  }
  // Refresh landing data on reconnect
  initSolPrice();
  initSolNews();
  // Auto-rejoin chat if last view was chat and there is no session
  try {
    const last = (localStorage.getItem('solchat_last_view') || '').toLowerCase();
    if (!currentUser && last === 'chat') {
      ensureSessionAndEnterChat();
    }
  } catch (_) {}
});

// Test function for debugging guest expiry (call from browser console)
window.testGuestExpiry = async function() {
  console.log('=== TESTING GUEST EXPIRY ===');
  console.log('Current user:', currentUser);
  console.log('Is guest:', isGuest());
  console.log('Is guest expired:', isGuestExpired());
  console.log('Guest expire key:', getGuestExpireKey());
  console.log('Guest expire at:', getGuestExpireAt());
  
  if (isGuest()) {
    console.log('Manually triggering guest expiry...');
    await handleGuestExpiry();
  } else {
    console.log('Not a guest user, cannot test expiry');
  }
};

// Force guest expiry in 5 seconds for testing
window.forceGuestExpiry = function() {
  if (isGuest()) {
    const key = getGuestExpireKey();
    const expireAt = Date.now() + 5000; // 5 seconds from now
    localStorage.setItem(key, String(expireAt));
    console.log('Guest expiry set to 5 seconds from now');
    startGuestTimerIfNeeded(); // Restart timer with new expiry
  } else {
    console.log('Not a guest user');
  }
};

// Manual cleanup of expired guests (call from browser console)
window.cleanupExpiredGuests = async function() {
  console.log('Manual guest cleanup disabled — no-op');
};

// Initial boot
(async function boot() {
  showLoading(true);
  try {
    // Default to guest UI without probing session on landing
    setNameWithBadge(profileName, 'Guest', null);
    profileEmail.textContent = '';
    try { logoutButton.style.display = 'none'; } catch (_) {}
    try { profileButton.style.display = 'none'; } catch (_) {}
    try { loginNavButton.style.display = ''; } catch (_) {}
    try { mentionsButton.style.display = 'none'; } catch (_) {}
    try { mentionsBadge.hidden = true; } catch (_) {}
    try { mentionsMenu.classList.remove('open'); } catch (_) {}
    // If a session already exists, update navbar to reflect logged-in state (without auto-entering chat)
    try {
      currentUser = await account.get();
      if (currentUser) {
        const display = getDisplayName(currentUser);
        setNameWithBadge(profileName, display, currentUser);
        profileEmail.textContent = currentUser.email || '';
        try { logoutButton.style.display = ''; } catch (_) {}
        try { profileButton.style.display = ''; } catch (_) {}
        try { loginNavButton.style.display = 'none'; } catch (_) {}
        try { mentionsButton.style.display = 'inline-flex'; } catch (_) {}
        try { updateMentionsBadge(); } catch (_) {}
      }
    } catch (_) {
      // Keep guest navbar if session probe fails
    }
    enforceVerified();
    const lastView = (localStorage.getItem('solchat_last_view') || '').toLowerCase();
    const url = new URL(location.href);
    const requestedView = (url.searchParams.get('view') || '').toLowerCase();
    const autoJoin = requestedView === 'chat' || url.searchParams.get('autojoin') === '1' || (location.hash === '#chat');
    const hasVerify = url.searchParams.get('verify') === '1' && url.searchParams.has('userId') && url.searchParams.has('secret');
    const hasRecovery = url.searchParams.has('userId') && url.searchParams.has('secret') && url.searchParams.get('recovery') === '1';
    if (hasVerify) {
      try {
        await account.updateVerification(url.searchParams.get('userId'), url.searchParams.get('secret'));
        toast('Email verified successfully. Welcome!', 'success');
        // Avoid probing session here; continue to landing
        enforceVerified();
      } catch (err) {
        console.error('Verification update error', err);
        toast(err?.message || 'Failed to verify email', 'error');
      } finally {
        url.searchParams.delete('verify');
        url.searchParams.delete('userId');
        url.searchParams.delete('secret');
        history.replaceState({}, document.title, url.toString());
      }
      // After verification, continue to landing
      showView('landing');
      initLanding();
    } else if (hasRecovery) {
      // Show reset form in auth view
      showView('auth');
      authForm.classList.add('hidden');
      resetForm.classList.remove('hidden');
      setAuthMode(false);
    } else if (currentUser && autoJoin) {
      // Auto-join chat only when explicitly requested via URL
      await enterChat();
  } else if (!currentUser && autoJoin) {
    // User requested chat via URL but has no session: prompt login first
    loginIntent = 'chat';
    showView('auth');
    setAuthMode(false);
    enforceVerified();
  } else {
      // Otherwise, respect landing/auth and do not auto-join chat
      showView('landing');
      initLanding();
    }
  } catch (err) {
    console.error('Boot error', err);
    toast('Error initializing app', 'error');
    showView('landing');
  } finally {
    showLoading(false);
  }
  
  // Start periodic cleanup of expired guests
  // Disabled: do not start guest cleanup
})();

// Resilient session recovery and auto-enter logic
async function ensureSessionAndEnterChat(isBoot = false) {
  // If already in chat or recovery running, avoid re-entering
  if ((hasEnteredChat && currentUser) || sessionRecoveryInProgress) return;
  sessionRecoveryInProgress = true;
  const maxAttempts = 5;
  let attempt = 0;
  const tryConnect = async () => {
    attempt += 1;
    try {
      // Try to reuse any existing session first
      try {
        currentUser = await account.get();
      } catch (_) {}
      if (!currentUser) {
        // No session: route to login rather than auto-creating guest
        loginIntent = 'chat';
        showView('auth');
        setAuthMode(false);
        sessionRecoveryInProgress = false;
        if (sessionRecoveryTimer) { try { clearTimeout(sessionRecoveryTimer); } catch (_) {} sessionRecoveryTimer = null; }
        return true;
      }
      enforceVerified();
      enforceBanUI();
      await enterChat();
      sessionRecoveryInProgress = false;
      if (sessionRecoveryTimer) { try { clearTimeout(sessionRecoveryTimer); } catch (_) {} sessionRecoveryTimer = null; }
      return true;
    } catch (err) {
      console.warn(`Session attempt ${attempt} failed`, err?.message || err);
      enforceVerified();
      if (attempt < maxAttempts) {
        const backoff = Math.min(6000, 1500 * attempt);
        sessionRecoveryTimer = setTimeout(tryConnect, backoff);
        return false;
      } else {
        try { toast('Unable to reconnect. Please check your connection.', 'error'); } catch (_) {}
        sessionRecoveryInProgress = false;
        return false;
      }
    }
  };
  // Start first attempt immediately
  tryConnect();
}

// Landing Logic
function initLanding() {
  if (TV_EMBEDS && !OFFLINE_MODE) {
    try { injectTradingViewEmbeds(); } catch (_) {}
  }
  initSolPrice();
  initSolNews();
  initSolChart();
  // Safety: ensure loading overlay never gets stuck visible
  try {
    setTimeout(() => { try { showLoading(false); } catch (_) {} }, 4000);
  } catch (_) {}
}

async function initSolPrice() {
  if (OFFLINE_MODE) {
    try { document.getElementById('tvQuoteContainer')?.style.setProperty('display', 'none'); } catch (_) {}
    try {
      solPriceEl.textContent = '—';
      solPriceChangeEl.textContent = '';
    } catch (_) {}
    return;
  }
  // If TradingView Single Quote widget exists in the price card, prefer it
  const tvQuote = document.getElementById('tvQuoteContainer');
  if (tvQuote) {
    // Wait briefly; if widget doesn't populate, fall back to manual price
    setTimeout(async () => {
      const hasWidget = !!(tvQuote.querySelector('iframe') || tvQuote.querySelector('.tradingview-widget-container__widget')?.childElementCount);
      if (!hasWidget) {
        await fetchSolPriceFallback();
      } else {
        // Hide fallback numbers if widget is present
        solPriceEl.textContent = '';
        solPriceChangeEl.textContent = '';
      }
    }, 1500);
    return;
  }
  await fetchSolPriceFallback();
}

async function fetchSolPriceFallback() {
  // Always hide empty TradingView quote container if present
  try { document.getElementById('tvQuoteContainer')?.style.setProperty('display', 'none'); } catch (_) {}

  // Try CoinCap first (often less blocked; includes 24h change)
  try {
    const res = await fetch('https://api.coincap.io/v2/assets/solana', { cache: 'no-store' });
    const json = await res.json();
    const price = Number(json?.data?.priceUsd);
    const change = Number(json?.data?.changePercent24Hr);
    if (!isNaN(price)) {
      solPriceEl.textContent = `$${price.toFixed(2)}`;
      if (!isNaN(change)) {
        const sign = change >= 0 ? '+' : '';
        solPriceChangeEl.textContent = `${sign}${change.toFixed(2)}% (24h)`;
        solPriceChangeEl.style.color = change >= 0 ? '#14f195' : '#ff4d4f';
      } else {
        solPriceChangeEl.textContent = '';
      }
      return;
    }
  } catch (err) { if (IS_DEBUG) console.warn('CoinCap price failed', err); }

  // Then try Jupiter price API (spot only)
  try {
    const res = await fetch('https://price.jup.ag/v4/price?ids=SOL', { cache: 'no-store' });
    const json = await res.json();
    const price = Number(json?.data?.SOL?.price);
    if (!isNaN(price)) {
      solPriceEl.textContent = `$${price.toFixed(2)}`;
      solPriceChangeEl.textContent = '';
      return;
    }
  } catch (err) { if (IS_DEBUG) console.warn('Jupiter price failed', err); }

  // Coingecko simple price with 24h change
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true';
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    const price = data?.solana?.usd;
    const change = data?.solana?.usd_24h_change;
    if (typeof price === 'number') {
      solPriceEl.textContent = `$${price.toFixed(2)}`;
    }
    if (typeof change === 'number') {
      const sign = change >= 0 ? '+' : '';
      solPriceChangeEl.textContent = `${sign}${change.toFixed(2)}% (24h)`;
      solPriceChangeEl.style.color = change >= 0 ? '#14f195' : '#ff4d4f';
    }
    if (typeof price === 'number') return;
  } catch (err) { if (IS_DEBUG) console.warn('Coingecko price failed', err); }

  // Coinbase fallback (spot only)
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot');
    const json = await res.json();
    const amt = Number(json?.data?.amount);
    if (!isNaN(amt)) {
      solPriceEl.textContent = `$${amt.toFixed(2)}`;
      solPriceChangeEl.textContent = '';
      return;
    }
  } catch (e) { if (IS_DEBUG) console.warn('Coinbase price failed', e); }

  // If everything fails, show placeholder
  solPriceEl.textContent = '—';
  solPriceChangeEl.textContent = '';
}

async function initSolNews() {
  if (OFFLINE_MODE) {
    try { document.getElementById('tvNewsContainer')?.style.setProperty('display', 'none'); } catch (_) {}
    try {
      solNewsListEl.innerHTML = '<div class="news__item">Offline mode: news disabled.</div>';
    } catch (_) {}
    return;
  }
  const tvContainer = document.querySelector('.tradingview-widget-container');
  if (tvContainer) {
    // Give the TradingView widget a moment; if it doesn't load, render fallback
    setTimeout(async () => {
      const hasWidgetContent = !!(tvContainer.querySelector('iframe') ||
        tvContainer.querySelector('.tradingview-widget-container__widget')?.childElementCount);
      if (!hasWidgetContent) {
        await renderSolNewsFallback();
      }
    }, 1500);
    return;
  }
  await renderSolNewsFallback();
}

async function renderSolNewsFallback() {
  try {
    // Hide empty TradingView news container if present
    try { document.getElementById('tvNewsContainer')?.style.setProperty('display', 'none'); } catch (_) {}
    const url = 'https://api.coingecko.com/api/v3/coins/solana/status_updates?per_page=5&page=1';
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    const updates = json?.status_updates || [];
    solNewsListEl.innerHTML = '';
    updates.forEach((u) => {
      const item = document.createElement('div');
      item.className = 'news__item';
      const title = document.createElement('div');
      title.className = 'news__title';
      title.textContent = u.project?.name || 'Solana';
      const meta = document.createElement('div');
      meta.className = 'news__meta';
      const ts = u?.created_at || u?.updated_at;
      meta.textContent = ts ? new Date(ts).toLocaleString() : '';
      const desc = document.createElement('div');
      desc.textContent = u.description || '';
      const link = document.createElement('a');
      link.className = 'news__link';
      link.href = u.article_url || u.url || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Read more';
      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(desc);
      if (link.href !== '#') item.appendChild(link);
      solNewsListEl.appendChild(item);
    });
    if (!updates.length) {
      solNewsListEl.innerHTML = '<div class="news__item">No recent updates found.</div>';
    }
  } catch (err) {
    if (IS_DEBUG) console.warn('News fetch failed', err);
    // Provide static sources as a graceful fallback
    solNewsListEl.innerHTML = '';
    const items = [
      { title: 'Solana News – CoinDesk', url: 'https://www.coindesk.com/tag/solana/' },
      { title: 'Solana Blog', url: 'https://solana.com/news' },
      { title: 'Solana Foundation Updates', url: 'https://solana.org/news' }
    ];
    items.forEach(({ title, url }) => {
      const item = document.createElement('div');
      item.className = 'news__item';
      const t = document.createElement('div');
      t.className = 'news__title';
      t.textContent = title;
      const link = document.createElement('a');
      link.className = 'news__link';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Visit';
      item.appendChild(t);
      item.appendChild(link);
      solNewsListEl.appendChild(item);
    });
    if (!solNewsListEl.childElementCount) {
      solNewsListEl.innerHTML = '<div class="news__item">Unable to load news right now. Try again later.</div>';
    }
  }
}

function injectTradingViewEmbeds() {
  const quoteContainer = document.getElementById('tvQuoteContainer');
  const newsContainer = document.getElementById('tvNewsContainer');
  if (quoteContainer) {
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js';
    s.async = true;
    s.text = JSON.stringify({
      symbol: TV_SYMBOL,
      colorTheme: TV_THEME,
      isTransparent: true,
      locale: 'en',
      width: '100%'
    });
    quoteContainer.appendChild(s);
  }
  if (newsContainer) {
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-timeline.js';
    s.async = true;
    s.text = JSON.stringify({
      displayMode: 'regular',
      feedMode: 'symbol',
      symbol: TV_SYMBOL,
      colorTheme: TV_THEME,
      isTransparent: true,
      locale: 'en',
      autosize: true
    });
    newsContainer.appendChild(s);
  }
}

function initSolChart() {
  if (chartInitialized) return;
  try {
    // Use TradingView widget with clean area config
    const forceFallback = false;
    if (!forceFallback && window.TradingView && solChartEl) {
      const tvWidget = new TradingView.widget({
        autosize: true,
        symbol: 'COINBASE:SOLUSD',
        interval: '60',
        timezone: 'Etc/UTC',
        theme: 'dark',
        // Area chart style
        style: '3',
        isTransparent: true,
        backgroundColor: 'rgba(0,0,0,0)',
        locale: 'en',
        // Hide the default Volume pane
        hide_volume: true,
        hidevolume: true,
        // Hide toolbars and extra controls for a clean chart
        hide_top_toolbar: true,
        hide_side_toolbar: true,
        withdateranges: false,
        studies: [],
        hidelegend: true,
        gridColor: 'rgba(0,0,0,0)',
        overrides: {
          'paneProperties.background': 'rgba(0,0,0,0)',
          'paneProperties.backgroundType': 'solid',
          'paneProperties.vertGridProperties.color': 'rgba(0,0,0,0)',
          'paneProperties.horzGridProperties.color': 'rgba(0,0,0,0)'
        },
        disabled_features: [
          'header_widget',
          'header_resolutions',
          'header_symbol_search',
          'header_compare',
          'header_chart_type',
          'header_fullscreen_button',
          'header_indicators',
          'header_saveload',
          'header_settings',
          'legend_widget',
          'show_hide_drawings_toolbar',
          'save_chart_properties_to_local_storage',
          'use_localstorage_for_settings',
          'create_volume_indicator_by_default'
          // Intentionally do not force overlay features; we'll remove volume entirely
        ],
        allow_symbol_change: false,
        container_id: 'solChart'
      });
      // Ensure no volume or studies are displayed
      try {
        tvWidget.onChartReady(() => {
          const chart = tvWidget.activeChart?.() || tvWidget.chart?.();
          const removeVolumeStudies = () => {
            try { chart?.removeAllStudies(); } catch (_) {}
            try {
              const studies = chart?.getAllStudies?.() || [];
              for (const s of studies) {
                const name = String(s?.name || s?.shortTitle || '').toLowerCase();
                if (name.includes('volume')) { try { chart?.removeStudy(s.id); } catch (_) {} }
              }
            } catch (_) {}
          };
          // Initial removal on ready
          removeVolumeStudies();
          // Guard against late-added default volume pane
          const scrubber = setInterval(removeVolumeStudies, 800);
          setTimeout(() => { try { clearInterval(scrubber); } catch (_) {} }, 6000);
          // Re-apply on symbol/interval changes just in case
          try { chart?.onSymbolChanged?.(() => setTimeout(removeVolumeStudies, 100)); } catch (_) {}
          try { chart?.onIntervalChanged?.(() => setTimeout(removeVolumeStudies, 100)); } catch (_) {}
        });
      } catch (_) {}
      // Verify widget mounted; if not, render a fallback chart
      setTimeout(() => {
        try {
          const hasIframe = !!solChartEl?.querySelector('iframe');
          const hasChildren = (solChartEl?.childElementCount || 0) > 0;
          if (!hasIframe && !hasChildren) {
            renderChartFallback();
          } else {
            chartInitialized = true;
          }
        } catch (_) { renderChartFallback(); }
      }, 1800);
    } else {
      renderChartFallback();
    }
  } catch (err) {
    console.warn('Chart init failed', err);
    renderChartFallback();
  }
}

// Helper: robust history fetch from multiple providers
async function getSolHistory24h() {
  const sources = [
    async () => {
      const url = 'https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=1&interval=hourly';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      const prices = Array.isArray(json?.prices) ? json.prices : [];
      return prices.map(([ts, price]) => ({ ts, price }));
    },
    async () => {
      const url = 'https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1h&limit=24';
      const res = await fetch(url, { cache: 'no-store' });
      const arr = await res.json();
      if (!Array.isArray(arr)) return [];
      // Binance returns [ openTime, open, high, low, close, volume, closeTime, ... ]
      return arr.map(k => ({ ts: k[0], price: Number(k[4]) }));
    },
    async () => {
      const url = 'https://api.coinbase.com/v2/prices/SOL-USD/historic?period=day';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      const prices = Array.isArray(json?.data?.prices) ? json.data.prices : [];
      // Coinbase prices are reverse chronological; normalize and convert time strings
      return prices.reverse().map(p => ({ ts: Date.parse(p.time), price: Number(p.price) }));
    }
  ];
  for (const fn of sources) {
    try {
      const pts = await fn();
      if (pts && pts.length) return pts;
    } catch (_) { /* try next */ }
  }
  return [];
}

async function fetchSolSpotPrice() {
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot');
    const json = await res.json();
    const amt = Number(json?.data?.amount);
    if (!isNaN(amt)) return amt;
  } catch (_) {}
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    const json = await res.json();
    const amt = Number(json?.price);
    if (!isNaN(amt)) return amt;
  } catch (_) {}
  return NaN;
}

async function renderChartFallback() {
  try {
    if (!solChartEl) return;
    chartInitialized = true;
    solChartEl.innerHTML = '';
    // Fetch 24h price history from multiple sources
    let points = await getSolHistory24h();
    if (!points.length) {
      const spot = await fetchSolSpotPrice();
      if (!isNaN(spot)) {
        // Build a flat line over 24 hours using spot price
        const now = Date.now();
        points = Array.from({ length: 24 }, (_, i) => ({ ts: now - (23 - i) * 3600_000, price: spot }));
      }
    }
    if (!points.length) {
      solChartEl.innerHTML = '<div style="padding:12px;font-size:12px;color:#a3a3a3;">Chart unavailable right now.</div>';
      return;
    }
    // Build a simple sparkline SVG
    const w = solChartEl.clientWidth || 600;
    const h = solChartEl.clientHeight || 360;
    const min = Math.min(...points.map(p => p.price));
    const max = Math.max(...points.map(p => p.price));
    const range = Math.max(0.0001, max - min);
    const pad = 8;
    const xs = points.map((_, i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1));
    const ys = points.map(p => pad + (h - pad * 2) * (1 - (p.price - min) / range));
    const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${Math.round(x)},${Math.round(ys[i])}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', 'solLineGrad');
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '1'); grad.setAttribute('y2', '0');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#9945ff');
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#14f195');
    grad.appendChild(stop1); grad.appendChild(stop2);
    // Area fill gradient (top to bottom)
    const areaGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    areaGrad.setAttribute('id', 'solAreaGrad');
    areaGrad.setAttribute('x1', '0'); areaGrad.setAttribute('y1', '0');
    areaGrad.setAttribute('x2', '0'); areaGrad.setAttribute('y2', '1');
    const a1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    a1.setAttribute('offset', '0%'); a1.setAttribute('stop-color', 'rgba(20,241,149,0.28)');
    const a2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    a2.setAttribute('offset', '100%'); a2.setAttribute('stop-color', 'rgba(20,241,149,0.02)');
    areaGrad.appendChild(a1); areaGrad.appendChild(a2);
    defs.appendChild(grad);
    defs.appendChild(areaGrad);
    svg.appendChild(defs);
    // Build area path (baseline at chart bottom padding)
    const yBase = pad + (h - pad * 2);
    const areaD = [
      `M${Math.round(xs[0])},${Math.round(yBase)}`,
      `L${Math.round(xs[0])},${Math.round(ys[0])}`,
      ...xs.slice(1).map((x, i) => `L${Math.round(x)},${Math.round(ys[i+1])}`),
      `L${Math.round(xs[xs.length-1])},${Math.round(yBase)}`,
      'Z'
    ].join(' ');
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('d', areaD);
    areaPath.setAttribute('fill', 'url(#solAreaGrad)');
    areaPath.setAttribute('stroke', 'none');
    svg.appendChild(areaPath);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'url(#solLineGrad)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path);
    solChartEl.appendChild(svg);
  } catch (err) {
    console.warn('Render chart fallback failed', err);
    try { solChartEl.innerHTML = '<div style="padding:12px;font-size:12px;color:#a3a3a3;">Chart unavailable right now.</div>'; } catch (_) {}
  }
}

// Join Chat button: route to Login when not already authenticated
joinChatButton?.addEventListener('click', async () => {
  try {
    showLoading(true);
    try { currentUser = await account.get(); } catch (_) {}
    // Join Live Chat should go to chat after auth
    loginIntent = 'chat';
    if (currentUser) {
      // If already authenticated, proceed into chat
      await afterLogin();
    } else {
      // Not authenticated: go to Login view (no auto-guest)
      showView('auth');
      setAuthMode(false);
    }
  } catch (err) {
    console.error('Join chat navigation failed', err);
    toast('Could not navigate to chat/login.', 'error');
  } finally {
    showLoading(false);
  }
});
// Forgot Password: request recovery email
forgotButton?.addEventListener('click', async () => {
  const email = (emailInput.value || '').trim();
  if (!email) {
    toast('Enter your email to reset password', 'error');
    emailInput.focus();
    return;
  }
  showLoading(true);
  try {
    const redirectUrl = `${location.origin}${location.pathname}?recovery=1`;
    await account.createRecovery(email, redirectUrl);
    toast('Recovery email sent. Check your inbox.', 'success');
  } catch (err) {
    console.error('Recovery request error', err);
    toast(err?.message || 'Failed to send recovery email', 'error');
  } finally {
    showLoading(false);
  }
});

// Reset Password form submission
resetForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = new URL(location.href);
  const userId = url.searchParams.get('userId');
  const secret = url.searchParams.get('secret');
  const p1 = (newPasswordInput.value || '').trim();
  const p2 = (confirmPasswordInput.value || '').trim();
  if (!p1 || !p2) { toast('Please enter and confirm your new password', 'error'); return; }
  if (p1.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
  if (p1 !== p2) { toast('Passwords do not match', 'error'); return; }
  showLoading(true);
  try {
    await account.updateRecovery(userId, secret, p1);
    toast('Password updated. Please login with your new password.', 'success');
    // Clear recovery params and return to login view
    url.searchParams.delete('userId');
    url.searchParams.delete('secret');
    history.replaceState({}, document.title, url.toString());
    resetForm.classList.add('hidden');
    authForm.classList.remove('hidden');
    setAuthMode(false);
  } catch (err) {
    console.error('Password reset error', err);
    toast(err?.message || 'Failed to update password', 'error');
  } finally {
    showLoading(false);
  }
});

// Cancel reset: return to login
resetCancelButton?.addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.delete('userId');
  url.searchParams.delete('secret');
  history.replaceState({}, document.title, url.toString());
  resetForm.classList.add('hidden');
  authForm.classList.remove('hidden');
  setAuthMode(false);
});
// Responsive mount: move input form into fixed footer on mobile
function isMobileViewport() {
  try { return window.matchMedia('(max-width: 640px)').matches; } catch (_) { return false; }
}
function updateInputMount() {
  try {
    if (!messageForm || !chatFooter) return;
    const inFooter = chatFooter.contains(messageForm);
    const isChatActive = !chatView.classList.contains('hidden');
    if (isMobileViewport() && isChatActive) {
      chatFooter.hidden = false;
      if (!inFooter) chatFooter.appendChild(messageForm);
    } else {
      chatFooter.hidden = true;
      const chatSection = document.querySelector('.chat.chat--layout');
      if (chatSection && !chatSection.contains(messageForm)) chatSection.appendChild(messageForm);
    }
  } catch (_) {}
}
window.addEventListener('resize', () => { try { updateInputMount(); } catch (_) {} }, { passive: true });
window.addEventListener('orientationchange', () => { try { updateInputMount(); } catch (_) {} });
// Encourage login from the timer banner
guestUpgradeButton?.addEventListener('click', () => {
  try { showView('auth'); setAuthMode(false); } catch (_) {}
});
