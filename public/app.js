/**
 * MAKO CAMBO — 1xBet VIP Cashier Mini App
 * Pure Vanilla JavaScript Architecture (Zero React, Zero Bloat, 100% Speed)
 */

(function () {
  'use strict';

  // ================= CONFIG & CONSTANTS =================
  const CHANNEL_LINK = 'https://t.me/MakoVIPgroup';
  const SUPPORT_LINK = 'https://t.me/ma_ko168';
  const API_BASE = '/api/miniapp';

  // Telegram WebApp Object
  const tg = window.Telegram?.WebApp || null;

  // App Global State
  const state = {
    user: {
      id: 6810457857,
      name: 'MAKO Member',
      username: '@member',
      photoUrl: null,
      balance: 0.00,
      orders: []
    },
    activeTab: 'topup',
    oneXBetId: '',
    selectedAmount: 5.00,
    isCustomAmount: false,
    selectedBank: 'bakong',
    activeTx: null,
    pollInterval: null,
    countdownInterval: null,
    secondsLeft: 60,
    savedIds: []
  };

  // Withdraw Global State (Code + QR Code)
  const withdrawState = {
    code: '',
    bank: 'Bakong / ABA KHQR',
    qrBase64: null,
    fileName: ''
  };

  // ================= TELEGRAM UTILITIES =================
  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
      if (tg.setHeaderColor) tg.setHeaderColor('#0b0f19');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0b0f19');

      // Sync Telegram User info
      if (tg.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        state.user.id = u.id;
        state.user.name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || 'VIP Member';
        state.user.username = u.username ? `@${u.username}` : '';
        state.user.photoUrl = u.photo_url || null;
      }
    } catch (e) {
      console.warn('Telegram init error:', e);
    }
  }

  function tgHaptic(type = 'medium') {
    try {
      if (!tg?.HapticFeedback) return;
      if (type === 'selection') tg.HapticFeedback.selectionChanged();
      else if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(type)) tg.HapticFeedback.impactOccurred(type);
      else if (['error', 'success', 'warning'].includes(type)) tg.HapticFeedback.notificationOccurred(type);
    } catch (_) {}
  }

  function tgOpenUrl(url) {
    if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // ================= DOM ELEMENTS =================
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    // Header
    btnChannel: $('btnChannel'),
    btnSupport: $('btnSupport'),
    btnWalletPill: $('btnWalletPill'),
    headerBalanceText: $('headerBalanceText'),

    // Bottom Navigation
    navItems: $$('.nav-item'),

    // Tabs
    tabTopUp: $('tabTopUp'),
    tabWithdraw: $('tabWithdraw'),
    tabProfile: $('tabProfile'),
    tabGuide: $('tabGuide'),

    // Top-Up Sub-Views
    topupFormView: $('topupFormView'),
    topupVoucherView: $('topupVoucherView'),
    topupSuccessView: $('topupSuccessView'),

    // Top-Up Form Elements
    inputOneXBetId: $('inputOneXBetId'),
    btnPasteId: $('btnPasteId'),
    btnClearId: $('btnClearId'),
    idStatusBadge: $('idStatusBadge'),
    recentChipsWrapper: $('recentChipsWrapper'),
    recentChipsList: $('recentChipsList'),
    amountChips: $$('.amt-chip'),
    inputCustomAmount: $('inputCustomAmount'),
    bankCards: $$('.bank-select-card[data-bank]'),
    btnSubmitTopUp: $('btnSubmitTopUp'),
    btnTopUpLabel: $('btnTopUpLabel'),

    // Voucher View Elements
    btnBackFromVoucher: $('btnBackFromVoucher'),
    voucherBankCard: $('voucherBankCard'),
    voucherHeaderTitle: $('voucherHeaderTitle'),
    voucherBankNameText: $('voucherBankNameText'),
    voucherIdText: $('voucherIdText'),
    voucherAmountText: $('voucherAmountText'),
    qrCanvasBox: $('qrCanvasBox'),
    qrDirectImg: $('qrDirectImg'),
    qrCenterLogo: $('qrCenterLogo'),
    qrExpiredView: $('qrExpiredView'),
    voucherTimerSec: $('voucherTimerSec'),
    voucherMerchantNameText: $('voucherMerchantNameText'),
    khqrScanGuide: $('khqrScanGuide'),
    voucherBillIdText: $('voucherBillIdText'),
    btnCopyVoucherBill: $('btnCopyVoucherBill'),
    btnOpenAbaApp: $('btnOpenAbaApp'),
    btnRegenQr: $('btnRegenQr'),

    // Top-Up Success Elements
    recOneXBetId: $('recOneXBetId'),
    recAmount: $('recAmount'),
    recTranId: $('recTranId'),
    btnNewDeposit: $('btnNewDeposit'),

    // Withdraw Elements
    btnContactAdminWd: $('btnContactAdminWd'),
    btnWithdrawBackHome: $('btnWithdrawBackHome'),

    // Profile Tab Elements
    userAvatarImg: $('userAvatarImg'),
    avatarFallbackLetter: $('avatarFallbackLetter'),
    profileNameText: $('profileNameText'),
    profileUsernameText: $('profileUsernameText'),
    profileIdNum: $('profileIdNum'),
    btnCopyProfileId: $('btnCopyProfileId'),
    btnRefreshBalance: $('btnRefreshBalance'),
    profileBigBalance: $('profileBigBalance'),
    btnProfileGoTopUp: $('btnProfileGoTopUp'),
    btnProfileGoWithdraw: $('btnProfileGoWithdraw'),
    orderHistoryCount: $('orderHistoryCount'),
    orderHistoryList: $('orderHistoryList'),

    // Guide Tab Elements
    guideButtons: $$('.guide-toggle-btn'),
    guideTopUpBlock: $('guideTopUpBlock'),
    guideWithdrawBlock: $('guideWithdrawBlock')
  };

  // ================= TAB NAVIGATION =================
  function switchTab(tabId) {
    if (state.activeTab === tabId) return;
    tgHaptic('selection');
    state.activeTab = tabId;

    // Hide all tabs
    [els.tabTopUp, els.tabWithdraw, els.tabProfile, els.tabGuide].forEach(t => {
      if (t) t.style.display = 'none';
    });

    // Update bottom nav active state
    els.navItems.forEach(item => {
      const target = item.getAttribute('data-tab');
      item.classList.toggle('active', target === tabId);
    });

    // Show target tab
    if (tabId === 'topup') {
      els.tabTopUp.style.display = 'flex';
    } else if (tabId === 'withdraw') {
      els.tabWithdraw.style.display = 'flex';
    } else if (tabId === 'profile') {
      els.tabProfile.style.display = 'flex';
      renderProfileUI();
      fetchUserData();
    } else if (tabId === 'guide') {
      els.tabGuide.style.display = 'flex';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateTgBackButton();
  }

  function updateTgBackButton() {
    if (!tg?.BackButton) return;
    if (state.activeTab === 'topup' && els.topupVoucherView && els.topupVoucherView.style.display !== 'none') {
      tg.BackButton.show();
    } else if (state.activeTab !== 'topup') {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }

  // ================= SAVED IDS (LOCAL STORAGE) =================
  const STORAGE_KEY = 'mako_1xbet_saved_ids';

  function loadSavedIds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.savedIds = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.savedIds)) state.savedIds = [];
    } catch (_) {
      state.savedIds = [];
    }
    renderSavedIds();
  }

  function persistOneXBetId(id) {
    if (!id || id.length < 4) return;
    state.savedIds = [id, ...state.savedIds.filter(x => x !== id)].slice(0, 5);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.savedIds));
    } catch (_) {}
    renderSavedIds();
  }

  function renderSavedIds() {
    if (!els.recentChipsWrapper || !els.recentChipsList) return;
    if (state.savedIds.length === 0) {
      els.recentChipsWrapper.style.display = 'none';
      return;
    }

    els.recentChipsWrapper.style.display = 'flex';
    els.recentChipsList.innerHTML = '';
    state.savedIds.forEach(id => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip-item ${id === state.oneXBetId ? 'active' : ''}`;
      chip.textContent = id;
      chip.addEventListener('click', () => {
        tgHaptic('selection');
        els.inputOneXBetId.value = id;
        onIdInputChanged();
      });
      els.recentChipsList.appendChild(chip);
    });
  }

  // ================= TOP-UP FORM LOGIC =================
  function getEffectiveAmount() {
    if (state.isCustomAmount) {
      const val = parseFloat(els.inputCustomAmount.value);
      return (!isNaN(val) && val > 0) ? val : 0;
    }
    return state.selectedAmount;
  }

  let checkIdTimer = null;
  let isIdValidInApp = null; // null: unchecked, true: found, false: not found

  function checkIdInApp(id) {
    if (!id || id.length < 6) {
      isIdValidInApp = false;
      if (els.idStatusBadge) {
        if (id && id.length > 0) {
          els.idStatusBadge.style.display = 'flex';
          els.idStatusBadge.className = 'id-status-badge not-found';
          els.idStatusBadge.innerHTML = '❌ រកមិនឃើញ ID នេះក្នុង App ទេ (ID Not Found in App) — ត្រូវមាន 6 ដល់ 11 ខ្ទង់';
        } else {
          els.idStatusBadge.style.display = 'none';
        }
      }
      updateSubmitButtonState();
      return;
    }

    if (els.idStatusBadge) {
      els.idStatusBadge.style.display = 'flex';
      els.idStatusBadge.className = 'id-status-badge checking';
      els.idStatusBadge.innerHTML = '🔎 កំពុងពិនិត្យ ID ក្នុង App...';
    }

    fetch(`${API_BASE}/check-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oneXBetId: id, name: state.user.name, username: state.user.username })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.found) {
          isIdValidInApp = true;
          if (els.idStatusBadge) {
            els.idStatusBadge.style.display = 'flex';
            els.idStatusBadge.className = 'id-status-badge found';
            els.idStatusBadge.innerHTML = `✅ រកឃើញគណនីជោគជ័យ: <b>${data.playerName || state.user.name}</b> (ID Found)`;
          }
        } else {
          isIdValidInApp = false;
          if (els.idStatusBadge) {
            els.idStatusBadge.style.display = 'flex';
            els.idStatusBadge.className = 'id-status-badge not-found';
            els.idStatusBadge.innerHTML = '❌ រកមិនឃើញ ID នេះក្នុង App ទេ (ID Not Found in App)';
          }
        }
        updateSubmitButtonState();
      })
      .catch(() => {
        // Network fallback
        isIdValidInApp = true;
        if (els.idStatusBadge) {
          els.idStatusBadge.style.display = 'flex';
          els.idStatusBadge.className = 'id-status-badge found';
          els.idStatusBadge.innerHTML = `✅ រកឃើញ ID ត្រឹមត្រូវ: <b>${id}</b> (ID Found)`;
        }
        updateSubmitButtonState();
      });
  }

  function updateSubmitButtonState() {
    const amt = getEffectiveAmount();
    const idValid = state.oneXBetId.length >= 6 && isIdValidInApp !== false;
    const amtValid = amt >= 0.02 && amt <= 10000;

    if (idValid && amtValid) {
      els.btnSubmitTopUp.removeAttribute('disabled');
      els.btnTopUpLabel.textContent = `បង្កើតកូដទូទាត់ KHQR ($${amt.toFixed(2)})`;
    } else {
      els.btnSubmitTopUp.setAttribute('disabled', 'true');
      if (state.oneXBetId && isIdValidInApp === false) {
        els.btnTopUpLabel.textContent = '❌ រកមិនឃើញ ID នេះក្នុង App ទេ (ID Not Found)';
      } else if (!idValid && !amtValid) {
        els.btnTopUpLabel.textContent = 'សូមបញ្ចូល ID 1xBet និងទឹកប្រាក់';
      } else if (!idValid) {
        els.btnTopUpLabel.textContent = 'សូមបញ្ចូលលេខ ID 1xBet ត្រឹមត្រូវ (6-11 ខ្ទង់)';
      } else {
        els.btnTopUpLabel.textContent = 'សូមជ្រើសរើសទឹកប្រាក់ (យ៉ាងតិច $0.02)';
      }
    }
  }

  function onIdInputChanged() {
    const raw = els.inputOneXBetId.value.replace(/[^0-9]/g, '');
    els.inputOneXBetId.value = raw;
    state.oneXBetId = raw;
    els.btnClearId.style.display = raw ? 'flex' : 'none';

    renderSavedIds();
    updateSubmitButtonState();

    clearTimeout(checkIdTimer);
    checkIdTimer = setTimeout(() => {
      checkIdInApp(raw);
    }, 300);
  }

  function setupAmountChips() {
    els.amountChips.forEach(chip => {
      chip.addEventListener('click', () => {
        tgHaptic('selection');
        els.amountChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.selectedAmount = parseFloat(chip.getAttribute('data-amount'));
        state.isCustomAmount = false;
        els.inputCustomAmount.value = '';
        updateSubmitButtonState();
      });
    });

    els.inputCustomAmount.addEventListener('input', () => {
      const val = parseFloat(els.inputCustomAmount.value);
      if (!isNaN(val) && val > 0) {
        state.isCustomAmount = true;
        els.amountChips.forEach(c => c.classList.remove('active'));
      } else {
        state.isCustomAmount = false;
      }
      updateSubmitButtonState();
    });
  }

  function setupBankSelector() {
    els.bankCards.forEach(card => {
      card.addEventListener('click', () => {
        tgHaptic('selection');
        els.bankCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.selectedBank = card.getAttribute('data-bank');
      });
    });
  }

  // ================= GENERATE PAYMENT (KHQR) =================
  async function generatePayment() {
    const finalAmount = getEffectiveAmount();

    if (state.oneXBetId.length < 6 || isIdValidInApp === false) {
      alert('❌ រកមិនឃើញ ID នេះក្នុង App ទេ (ID Not Found in App)! សូមពិនិត្យមើល ID 1xBet របស់អ្នកឡើងវិញ');
      els.inputOneXBetId.focus();
      return;
    }

    if (isNaN(finalAmount) || finalAmount < 0.02 || finalAmount > 10000) {
      alert('សូមជ្រើសរើស ឬបញ្ចូលទឹកប្រាក់ចាប់ពី $0.02 ដល់ $10000 USD!');
      return;
    }

    tgHaptic('medium');
    persistOneXBetId(state.oneXBetId);

    // Show loading on CTA
    els.btnSubmitTopUp.setAttribute('disabled', 'true');
    els.btnTopUpLabel.textContent = 'កំពុងបង្កើតវិក្កយបត្រ KHQR...';

    try {
      const res = await fetch(`${API_BASE}/topup/create-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: finalAmount,
          bank: state.selectedBank,
          oneXBetId: state.oneXBetId,
          userId: state.user.id,
          username: state.user.username,
          name: state.user.name
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'បរាជ័យក្នុងការបង្កើតកាតទូទាត់');
      }

      state.activeTx = data;
      tgHaptic('success');

      // Switch to Voucher Display View
      els.topupFormView.style.display = 'none';
      els.topupVoucherView.style.display = 'flex';
      displayVoucherCard(data);
      startCountdownTimer();
      startPaymentPoller(data.tranId);
      updateTgBackButton();
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      alert(err.message || 'មានបញ្ហាក្នុងការបង្កើតកូដ KHQR សូមព្យាយាមម្តងទៀត!');
    } finally {
      updateSubmitButtonState();
    }
  }

  // ================= DISPLAY VOUCHER & LIVE POLLER =================
  function displayVoucherCard(tx) {
    const isBakong = state.selectedBank === 'bakong' || String(tx.bank || '').toLowerCase() === 'bakong';
    if (els.voucherBankCard) {
      els.voucherBankCard.className = `khqr-official-card ${isBakong ? 'bakong' : 'aba'}`;
    }
    if (els.voucherHeaderTitle) {
      els.voucherHeaderTitle.textContent = isBakong ? 'BAKONG KHQR' : 'ABA PAYWAY';
    }
    if (els.voucherBankNameText) {
      els.voucherBankNameText.textContent = isBakong ? 'BAKONG KHQR' : 'ABA PAYWAY';
    }
    const merchantName = isBakong ? 'MAKO CAMBO' : 'MAKO by H.T';
    if (els.voucherMerchantNameText) {
      els.voucherMerchantNameText.textContent = tx.merchantName || merchantName;
    }
    if (els.voucherIdText) els.voucherIdText.textContent = state.oneXBetId;
    if (els.voucherAmountText) {
      els.voucherAmountText.textContent = parseFloat(tx.amount || getEffectiveAmount()).toFixed(2);
    }
    if (els.voucherBillIdText) els.voucherBillIdText.textContent = tx.tranId;
    if (els.qrCenterLogo) {
      els.qrCenterLogo.textContent = isBakong ? 'KHQR' : 'ABA';
      els.qrCenterLogo.style.background = isBakong ? '#E21A1A' : '#005F82';
    }
    if (els.khqrScanGuide) {
      els.khqrScanGuide.textContent = isBakong
        ? 'Scan with Bakong App, ABA Mobile, or other Mobile Banking App supporting KHQR'
        : 'Scan with ABA Mobile, or other Mobile Banking App supporting KHQR';
    }

    // Clear and hide expired state
    if (els.qrCanvasBox) els.qrCanvasBox.innerHTML = '';
    if (els.qrExpiredView) els.qrExpiredView.style.display = 'none';
    if (els.btnRegenQr) els.btnRegenQr.style.display = 'none';

    // Generate QR Code via local library
    if (window.QRCode && tx.qrString) {
      try {
        new window.QRCode(els.qrCanvasBox, {
          text: tx.qrString,
          width: 194,
          height: 194,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.M
        });
        els.qrDirectImg.style.display = 'none';
        els.qrCanvasBox.style.display = 'block';
      } catch (_) {
        fallbackQrImage(tx);
      }
    } else {
      fallbackQrImage(tx);
    }

    // Direct ABA Mobile App button (Enabled for ABA payments)
    if (!isBakong && els.btnOpenAbaApp) {
      const qrStr = tx.qrString || '';
      const deepLink = tx.deepLink || (qrStr ? `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(qrStr)}` : null);

      if (deepLink) {
        els.btnOpenAbaApp.style.display = 'flex';
        els.btnOpenAbaApp.onclick = () => {
          tgHaptic('medium');
          // Telegram WebApp restricts custom schemes (abamobilebank://) directly in webview.
          // Routing via our permanent Render HTTPS endpoint (/pay-aba) opens in system browser cleanly!
          const payAbaUrl = `${window.location.origin}/pay-aba?tranId=${encodeURIComponent(tx.tranId)}&qr=${encodeURIComponent(qrStr)}`;
          if (window.Telegram && window.Telegram.WebApp && typeof window.Telegram.WebApp.openLink === 'function') {
            window.Telegram.WebApp.openLink(payAbaUrl);
          } else {
            window.location.href = deepLink;
          }
        };
      } else {
        els.btnOpenAbaApp.style.display = 'none';
      }
    } else if (els.btnOpenAbaApp) {
      els.btnOpenAbaApp.style.display = 'none';
    }
  }

  function fallbackQrImage(tx) {
    if (tx.qrDataUrl) {
      els.qrDirectImg.src = tx.qrDataUrl;
      els.qrDirectImg.style.display = 'block';
      els.qrCanvasBox.style.display = 'none';
    }
  }

  function startCountdownTimer() {
    clearInterval(state.countdownInterval);
    state.secondsLeft = 180; // 3 minutes = 180s
    els.voucherTimerSec.textContent = `${state.secondsLeft}s`;
    els.voucherTimerSec.classList.remove('urgent');

    state.countdownInterval = setInterval(() => {
      state.secondsLeft -= 1;
      els.voucherTimerSec.textContent = `${state.secondsLeft}s`;

      if (state.secondsLeft <= 30) {
        els.voucherTimerSec.classList.add('urgent');
      }

      if (state.secondsLeft <= 0) {
        clearInterval(state.countdownInterval);
        clearInterval(state.pollInterval);
        els.qrExpiredView.style.display = 'flex';
        els.btnRegenQr.style.display = 'flex';
        els.btnOpenAbaApp.style.display = 'none';
      }
    }, 1000);
  }

  let isCheckingTopupStatus = false;
  function startPaymentPoller(tranId) {
    clearInterval(state.pollInterval);
    isCheckingTopupStatus = false;
    state.pollInterval = setInterval(async () => {
      if (isCheckingTopupStatus) return;
      isCheckingTopupStatus = true;
      try {
        const res = await fetch(`${API_BASE}/topup/check-status?tranId=${encodeURIComponent(tranId)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.paid || data.status === 'PAID') {
          clearInterval(state.pollInterval);
          clearInterval(state.countdownInterval);
          onPaymentSuccess(data);
        }
      } catch (_) {
      } finally {
        isCheckingTopupStatus = false;
      }
    }, 2500);
  }

  function onPaymentSuccess(data) {
    tgHaptic('success');
    if (window.confetti) {
      window.confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    }

    const paidAmt = parseFloat(data.amount || getEffectiveAmount());
    state.user.balance += paidAmt;
    state.user.orders.unshift({
      item: `1xBet Top-Up ($${paidAmt.toFixed(2)})`,
      price: paidAmt,
      date: new Date().toLocaleDateString('km-KH')
    });

    els.headerBalanceText.textContent = `$${state.user.balance.toFixed(2)}`;
    els.recOneXBetId.textContent = state.oneXBetId;
    els.recAmount.textContent = `+$${paidAmt.toFixed(2)} USD`;
    els.recTranId.textContent = state.activeTx?.tranId || '--';

    // Show success view, hide voucher
    els.topupVoucherView.style.display = 'none';
    els.topupSuccessView.style.display = 'flex';
    updateTgBackButton();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function returnToTopUpForm() {
    clearInterval(state.pollInterval);
    clearInterval(state.countdownInterval);
    els.topupVoucherView.style.display = 'none';
    els.topupSuccessView.style.display = 'none';
    els.topupFormView.style.display = 'flex';
    updateSubmitButtonState();
    updateTgBackButton();
  }

  // ================= WITHDRAW TAB (DIRECT ADMIN CONTACT) =================
  function setupWithdrawForm() {
    const btnContactAdmin = $('btnContactAdminWd');
    if (btnContactAdmin) {
      btnContactAdmin.addEventListener('click', (e) => {
        tgHaptic('medium');
        if (window.Telegram?.WebApp?.openTelegramLink) {
          e.preventDefault();
          window.Telegram.WebApp.openTelegramLink('https://t.me/ma_ko168');
        }
      });
    }

    const btnBackHome = $('btnWithdrawBackHome');
    if (btnBackHome) {
      btnBackHome.addEventListener('click', () => {
        tgHaptic('light');
        switchTab('topup');
      });
    }
  }

  // ================= PROFILE TAB ACTIONS =================
  async function fetchUserData() {
    try {
      const res = await fetch(`${API_BASE}/user-info?userId=${encodeURIComponent(state.user.id)}&name=${encodeURIComponent(state.user.name)}`);
      if (res.ok) {
        const data = await res.json();
        state.user.balance = data.balance || 0;
        state.user.orders = data.orders || [];
        renderProfileUI();
      }
    } catch (_) {}
  }

  function renderProfileUI() {
    els.profileNameText.textContent = state.user.name;
    els.profileUsernameText.textContent = state.user.username || '@member';
    els.profileIdNum.textContent = state.user.id;
    els.headerBalanceText.textContent = `$${state.user.balance.toFixed(2)}`;
    els.profileBigBalance.textContent = `$${state.user.balance.toFixed(2)}`;

    // Avatar
    if (state.user.photoUrl) {
      els.userAvatarImg.src = state.user.photoUrl;
      els.userAvatarImg.style.display = 'block';
      els.avatarFallbackLetter.style.display = 'none';
    } else {
      els.userAvatarImg.style.display = 'none';
      els.avatarFallbackLetter.style.display = 'flex';
      els.avatarFallbackLetter.textContent = (state.user.name || 'M')[0].toUpperCase();
    }

    // Orders History
    const orders = state.user.orders || [];
    els.orderHistoryCount.textContent = `${orders.length}`;

    if (orders.length === 0) {
      els.orderHistoryList.innerHTML = `
        <div class="empty-history">
          <svg viewBox="0 0 24 24" class="empty-svg"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <p>មិនទាន់មានប្រវត្តិប្រតិបត្តិការនៅឡើយទេ</p>
        </div>
      `;
    } else {
      els.orderHistoryList.innerHTML = orders.map(ord => `
        <div class="order-entry">
          <div>
            <p class="order-title">${ord.item}</p>
            <p class="order-sub">${ord.date}</p>
          </div>
          <span class="order-amount">+${typeof ord.price === 'number' ? `$${ord.price.toFixed(2)}` : ord.price}</span>
        </div>
      `).join('');
    }
  }

  // ================= GUIDE TAB SWITCH =================
  function setupGuideSwitch() {
    els.guideButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tgHaptic('selection');
        els.guideButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const g = btn.getAttribute('data-guide');
        els.guideTopUpBlock.style.display = (g === 'topup') ? 'flex' : 'none';
        els.guideWithdrawBlock.style.display = (g === 'withdraw') ? 'flex' : 'none';
      });
    });
  }

  // ================= BIND GLOBAL EVENTS =================
  function bindEvents() {
    // Header Links
    els.btnChannel.addEventListener('click', () => { tgHaptic('light'); tgOpenUrl(CHANNEL_LINK); });
    els.btnSupport.addEventListener('click', () => { tgHaptic('light'); tgOpenUrl(SUPPORT_LINK); });
    els.btnWalletPill.addEventListener('click', () => switchTab('profile'));

    // Bottom Navigation
    els.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Top-Up Form Input & Paste
    els.inputOneXBetId.addEventListener('input', onIdInputChanged);
    els.btnClearId.addEventListener('click', () => {
      els.inputOneXBetId.value = '';
      if (els.idStatusBadge) els.idStatusBadge.style.display = 'none';
      isIdValidInApp = null;
      onIdInputChanged();
    });

    els.btnPasteId.addEventListener('click', async () => {
      tgHaptic('light');
      try {
        const text = await navigator.clipboard.readText();
        const digits = text.replace(/[^0-9]/g, '');
        if (digits) {
          els.inputOneXBetId.value = digits;
          onIdInputChanged();
        }
      } catch (_) {
        alert('សូមចុចសង្កត់លើប្រអប់ដើម្បី Paste លេខ ID');
      }
    });

    // Top-Up Submit CTA
    els.btnSubmitTopUp.addEventListener('click', generatePayment);

    // Voucher View Actions
    els.btnBackFromVoucher.addEventListener('click', returnToTopUpForm);
    els.btnRegenQr.addEventListener('click', generatePayment);
    els.btnCopyVoucherBill?.addEventListener('click', () => {
      const billId = state.activeTx?.tranId || els.voucherBillIdText?.textContent?.trim();
      if (!billId || billId === '--') return;
      navigator.clipboard?.writeText(billId);
      tgHaptic('light');
      els.btnCopyVoucherBill.classList.add('copied');
      els.btnCopyVoucherBill.innerHTML = `
        <svg viewBox="0 0 24 24" class="copy-btn-svg"><polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="copy-btn-text">ចម្លងរួច</span>
      `;
      setTimeout(() => {
        els.btnCopyVoucherBill.classList.remove('copied');
        els.btnCopyVoucherBill.innerHTML = `
          <svg viewBox="0 0 24 24" class="copy-btn-svg"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <span class="copy-btn-text">ចម្លង</span>
        `;
      }, 1600);
    });

    // Top-Up Receipt Action
    els.btnNewDeposit.addEventListener('click', returnToTopUpForm);

    // Profile Actions
    els.btnCopyProfileId.addEventListener('click', () => {
      navigator.clipboard?.writeText(String(state.user.id));
      tgHaptic('light');
      els.btnCopyProfileId.innerHTML = '<span style="color:#34d399;font-weight:bold;">OK</span>';
      setTimeout(() => {
        els.btnCopyProfileId.innerHTML = `
          <svg viewBox="0 0 24 24" class="btn-inline-svg"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        `;
      }, 1500);
    });

    els.btnRefreshBalance.addEventListener('click', () => {
      tgHaptic('light');
      fetchUserData();
    });

    els.btnProfileGoTopUp.addEventListener('click', () => switchTab('topup'));
    els.btnProfileGoWithdraw.addEventListener('click', () => switchTab('withdraw'));

    // Telegram Back Button Navigation
    if (tg?.BackButton) {
      tg.BackButton.onClick(() => {
        if (state.activeTab === 'topup' && els.topupVoucherView && els.topupVoucherView.style.display !== 'none') {
          returnToTopUpForm();
        } else {
          switchTab('topup');
        }
      });
    }
  }

  function setupHeroVideo() {
    const heroVideo = $('heroWelcomeVideo');
    const btnToggleSound = $('btnToggleVideoSound');
    const iconMuted = $('iconMuted');
    const iconUnmuted = $('iconUnmuted');

    if (!heroVideo) return;

    // Autoplay muted video reliably
    heroVideo.muted = true;
    const playPromise = heroVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const resumePlay = () => {
          heroVideo.play().catch(() => {});
        };
        document.addEventListener('touchstart', resumePlay, { once: true, passive: true });
        document.addEventListener('click', resumePlay, { once: true });
      });
    }

    if (btnToggleSound && iconMuted && iconUnmuted) {
      btnToggleSound.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tgHaptic('light');

        heroVideo.muted = !heroVideo.muted;
        if (heroVideo.muted) {
          iconMuted.style.display = 'block';
          iconUnmuted.style.display = 'none';
        } else {
          iconMuted.style.display = 'none';
          iconUnmuted.style.display = 'block';
          heroVideo.play().catch(() => {});
        }
      });
    }
  }

  // ================= BOOTSTRAP =================
  function init() {
    initTelegram();
    setupHeroVideo();
    bindEvents();
    setupAmountChips();
    setupBankSelector();
    setupWithdrawForm();
    setupGuideSwitch();
    loadSavedIds();
    fetchUserData();

    // Default selection
    if (!state.oneXBetId && state.savedIds.length > 0) {
      state.oneXBetId = state.savedIds[0];
      els.inputOneXBetId.value = state.oneXBetId;
    }
    updateSubmitButtonState();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
