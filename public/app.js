const phoneInput = document.getElementById('phone');
const countryCodeSelect = document.getElementById('country-code');
const emailLookupInput = document.getElementById('email-lookup');
const otpInput = document.getElementById('otp');
const btnSend = document.getElementById('btn-send-otp');
const btnLookupMobile = document.getElementById('btn-lookup-mobile');
const btnVerify = document.getElementById('btn-verify-otp');
const btnBack = document.getElementById('btn-back');
const stepPhone = document.getElementById('step-phone');
const stepOtp = document.getElementById('step-otp');
const messageBox = document.getElementById('message-box');
const otpMessage = document.getElementById('otp-message');
const companyName = document.getElementById('company-name');
const loginHeading = document.getElementById('login-heading');
const loginSubtitle = document.getElementById('login-subtitle');
const registrationModal = document.getElementById('registration-modal');
const registrationModalBackdrop = document.getElementById('registration-modal-backdrop');
const registrationModalClose = document.getElementById('registration-modal-close');
const registrationModalTitle = document.getElementById('registration-modal-title');
const registrationModalSubtitle = document.getElementById('registration-modal-subtitle');
const registrationModalContent = document.getElementById('registration-modal-content');

let currentPhone = '';
let currentLocalPhone = '';
let currentCountryCode = '';
let authMode = 'employee';
const REQUEST_TIMEOUT_MS = 20000;

const params = new URLSearchParams(window.location.search);
const returnTo = params.get('return_to');

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMessageContent(content) {
    if (typeof content === 'string') {
        return `<div class="message-detail">${escapeHtml(content)}</div>`;
    }

    const detail = content.detail || content.error || '';
    const parts = [];

    if (content.title) {
        parts.push(`<div class="message-title">${escapeHtml(content.title)}</div>`);
    }

    if (detail) {
        parts.push(`<div class="message-detail">${escapeHtml(detail)}</div>`);
    }

    if (
        (!Array.isArray(content.records) || content.records.length === 0) &&
        Array.isArray(content.maskedMobiles) &&
        content.maskedMobiles.length > 0
    ) {
        const items = content.maskedMobiles
            .map((mobile) => `<li>${escapeHtml(mobile)}</li>`)
            .join('');
        parts.push(`<ul class="message-list">${items}</ul>`);
    }

    if (Array.isArray(content.records) && content.records.length > 0) {
        const items = content.records
            .map((record) => `<li>Recorded mobile number = ${escapeHtml(record.maskedMobile)}, status = ${escapeHtml(record.status)}</li>`)
            .join('');
        parts.push(`<ul class="message-list">${items}</ul>`);
    }

    if (content.hint) {
        parts.push(`<div class="message-hint">${escapeHtml(content.hint)}</div>`);
    }

    if (content.actionUrl && content.actionLabel) {
        parts.push(
            `<a class="message-action-button" href="${escapeHtml(content.actionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(content.actionLabel)}</a>`
        );
    }

    return parts.join('');
}

function formatSystemAlert(detail) {
    return `[system alert] : ${detail}`;
}

function renderOverviewValue(value, tone = 'default') {
    return `<div class="status-overview-value status-overview-value-${escapeHtml(tone)}">${escapeHtml(value)}</div>`;
}

function renderOverviewSection(label, value, detail, options = {}) {
    const actions = [];

    if (options.actionUrl && options.actionLabel) {
        actions.push(
            `<a class="message-action-button" href="${escapeHtml(options.actionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(options.actionLabel)}</a>`
        );
    }

    return `
        <section class="status-overview-section">
            <div class="status-overview-heading">
                <div class="status-overview-label">[ ${escapeHtml(label)} ]</div>
                ${value}
            </div>
            ${detail ? `<div class="status-overview-detail">${escapeHtml(detail)}</div>` : ''}
            ${actions.join('')}
        </section>
    `;
}

function renderRegisteredMobiles(registeredMobiles) {
    if (!Array.isArray(registeredMobiles) || registeredMobiles.length === 0) {
        return renderOverviewValue('Not found', 'muted');
    }

    if (registeredMobiles.length === 1) {
        return renderOverviewValue(registeredMobiles[0], 'default');
    }

    const items = registeredMobiles
        .map((mobile) => `<li class="status-overview-mobile-pill">${escapeHtml(mobile)}</li>`)
        .join('');

    return `<ul class="status-overview-mobile-list">${items}</ul>`;
}

function getOverviewTone(value) {
    const normalized = String(value || '').toUpperCase();

    if (normalized === 'YES' || normalized === 'APPROVED' || normalized === 'FOUND') {
        return 'success';
    }

    if (normalized.includes('PENDING')) {
        return 'warning';
    }

    if (
        normalized.includes('BLOCKED') ||
        normalized.includes('NOT FOUND') ||
        normalized.includes('NOT REGISTERED') ||
        normalized === 'NO'
    ) {
        return 'danger';
    }

    return 'default';
}

function showRegistrationOverview(overview) {
    registrationModalTitle.textContent = overview.title || 'Registration Status Overview';
    registrationModalSubtitle.textContent = `${overview.lookupLabel || 'Lookup'}: ${overview.lookupValue || '-'}`;

    registrationModalContent.innerHTML = [
        renderOverviewSection(
            'APPLICATION RECEIVED',
            renderOverviewValue(overview.applicationReceived?.status || '-', getOverviewTone(overview.applicationReceived?.status)),
            overview.applicationReceived?.detail || '',
            {
                actionUrl: overview.applicationReceived?.actionUrl,
                actionLabel: overview.applicationReceived?.actionLabel
            }
        ),
        renderOverviewSection(
            'MOBILE NUMBER REGISTERED',
            renderRegisteredMobiles(overview.registeredMobiles),
            Array.isArray(overview.registeredMobiles) && overview.registeredMobiles.length > 1
                ? 'Multiple mobile numbers are linked to this record.'
                : ''
        ),
        renderOverviewSection(
            'REGISTRATION STATUS',
            renderOverviewValue(overview.registrationStatus?.status || '-', getOverviewTone(overview.registrationStatus?.status)),
            overview.registrationStatus?.detail || ''
        ),
        renderOverviewSection(
            'ACCOUNT ACTIVATED',
            renderOverviewValue(overview.accountActivated?.status || '-', getOverviewTone(overview.accountActivated?.status)),
            overview.accountActivated?.detail || ''
        )
    ].join('');

    registrationModal.classList.remove('hidden');
    registrationModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function hideRegistrationOverview() {
    registrationModal.classList.add('hidden');
    registrationModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    registrationModalContent.innerHTML = '';
}

function showMessage(content, type = 'success') {
    messageBox.innerHTML = renderMessageContent(content);
    messageBox.className = type;
    messageBox.classList.remove('hidden');
}

function showApiMessage(payload, fallbackText, type = 'error') {
    if (payload && typeof payload === 'object' && payload.registrationOverview) {
        hideMessage();
        showRegistrationOverview(payload.registrationOverview);
        return;
    }

    if (payload && typeof payload === 'object' && payload.systemAlert) {
        showMessage(formatSystemAlert(payload.detail || payload.error || fallbackText), 'error');
        return;
    }

    if (payload && typeof payload === 'object') {
        showMessage(
            {
                title: payload.title,
                detail: payload.detail || payload.error || fallbackText,
                hint: payload.hint,
                records: payload.records,
                maskedMobiles: payload.maskedMobiles,
                actionUrl: payload.actionUrl,
                actionLabel: payload.actionLabel
            },
            type
        );
        return;
    }

    showMessage(fallbackText, type);
}

function hideMessage() {
    messageBox.classList.add('hidden');
    messageBox.innerHTML = '';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function parseJsonSafe(response) {
    try {
        return await response.json();
    } catch (err) {
        return {};
    }
}

function applyAuthContext(context) {
    authMode = context.mode || 'employee';

    if (context.isReferralAuth) {
        document.title = context.pageTitle || 'ETERNALGY REFERRAL LOGIN';
        companyName.textContent = context.loginTitle || 'ETERNALGY REFERRAL LOGIN';
        loginHeading.textContent = 'ETERNALGY REFERRAL LOGIN';
        loginSubtitle.textContent = 'Enter your referral mobile number to receive a WhatsApp OTP.';
        btnVerify.textContent = 'Verify & Login';
    }
}

async function loadAuthContext() {
    if (!returnTo) return;

    try {
        const res = await fetch(`/auth/context?return_to=${encodeURIComponent(returnTo)}`);
        if (!res.ok) return;
        const context = await res.json();
        applyAuthContext(context);
    } catch (err) {
        console.error('Failed to load auth context', err);
    }
}

btnSend.addEventListener('click', async () => {
    const phone = phoneInput.value.trim();
    if (!phone) {
        showMessage('Please enter your mobile number.', 'error');
        return;
    }

    if (!/^\d+$/.test(phone)) {
        showMessage('Please enter numbers only.', 'error');
        return;
    }

    hideMessage();
    hideRegistrationOverview();
    btnSend.disabled = true;
    btnSend.textContent = 'Sending...';

    const countryCode = countryCodeSelect.value;
    const cleanCountryCode = countryCode.replace(/\D/g, '');
    const fullPhoneNumber = `${cleanCountryCode}${phone.replace(/^0+/, '')}`;

    try {
        const res = await fetchWithTimeout('/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber: fullPhoneNumber,
                localPhoneNumber: phone,
                countryCode,
                returnTo
            })
        });

        const data = await parseJsonSafe(res);

        if (res.ok) {
            currentPhone = fullPhoneNumber;
            currentLocalPhone = phone;
            currentCountryCode = countryCode;
            otpMessage.textContent = `Code sent to ${countryCode}${phone}`;
            stepPhone.classList.remove('active');
            stepOtp.classList.add('active');
            otpInput.focus();
        } else {
            showApiMessage(data, res.status >= 500 ? formatSystemAlert(data.detail || data.error || 'Failed to send code.') : 'Failed to send code.', 'error');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showMessage(formatSystemAlert('Request timed out. Please try again.'), 'error');
        } else {
            showMessage(formatSystemAlert('Network error. Please try again.'), 'error');
        }
    } finally {
        btnSend.disabled = false;
        btnSend.textContent = 'Continue';
    }
});

btnLookupMobile.addEventListener('click', async () => {
    const email = emailLookupInput.value.trim();
    if (!email) {
        showMessage('Please enter your registered email address.', 'error');
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMessage('Please enter a valid email address.', 'error');
        return;
    }

    hideMessage();
    hideRegistrationOverview();
    btnLookupMobile.disabled = true;
    btnLookupMobile.textContent = 'Checking...';

    try {
        const res = await fetchWithTimeout('/auth/lookup-mobile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, returnTo })
        });

        const data = await parseJsonSafe(res);

        if (res.ok) {
            showApiMessage(data, 'Registered mobile number found.', 'success');
        } else {
            showApiMessage(
                data,
                res.status >= 500 ? formatSystemAlert(data.detail || data.error || 'Unable to find a registered mobile number for this email.') : 'Unable to find a registered mobile number for this email.',
                'error'
            );
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showMessage(formatSystemAlert('Request timed out. Please try again.'), 'error');
        } else {
            showMessage(formatSystemAlert('Network error. Please try again.'), 'error');
        }
    } finally {
        btnLookupMobile.disabled = false;
        btnLookupMobile.textContent = 'Check Registered Mobile';
    }
});

btnVerify.addEventListener('click', async () => {
    const code = otpInput.value.trim();
    if (!code) {
        showMessage('Please enter the 6-digit code.', 'error');
        return;
    }

    hideMessage();
    hideRegistrationOverview();
    btnVerify.disabled = true;
    btnVerify.textContent = 'Verifying...';

    try {
        const res = await fetchWithTimeout('/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber: currentPhone,
                localPhoneNumber: currentLocalPhone,
                countryCode: currentCountryCode,
                code,
                returnTo
            })
        });

        const data = await parseJsonSafe(res);

        if (res.ok) {
            showMessage('Authentication successful! Redirecting...', 'success');

            setTimeout(() => {
                if (returnTo) {
                    window.location.href = decodeURIComponent(returnTo);
                } else if (data.user && data.user.isAdmin) {
                    window.location.href = '/admin/dashboard';
                } else {
                    window.location.href = '/docs';
                }
            }, 1000);
        } else {
            showApiMessage(data, res.status >= 500 ? formatSystemAlert(data.detail || data.error || 'Invalid code.') : 'Invalid code.', 'error');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showMessage(formatSystemAlert('Request timed out. Please try again.'), 'error');
        } else {
            showMessage(formatSystemAlert('Network error. Please try again.'), 'error');
        }
    } finally {
        btnVerify.disabled = false;
        btnVerify.textContent = 'Verify & Login';
    }
});

btnBack.addEventListener('click', () => {
    stepOtp.classList.remove('active');
    stepPhone.classList.add('active');
    hideMessage();
    hideRegistrationOverview();
});

phoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnSend.click();
});

emailLookupInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnLookupMobile.click();
});

otpInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnVerify.click();
});

registrationModalClose.addEventListener('click', hideRegistrationOverview);
registrationModalBackdrop.addEventListener('click', hideRegistrationOverview);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideRegistrationOverview();
    }
});

loadAuthContext();
