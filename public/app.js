const phoneInput = document.getElementById('phone');
const countryCodeSelect = document.getElementById('country-code');
const otpInput = document.getElementById('otp');
const btnSend = document.getElementById('btn-send-otp');
const btnVerify = document.getElementById('btn-verify-otp');
const btnBack = document.getElementById('btn-back');
const stepPhone = document.getElementById('step-phone');
const stepOtp = document.getElementById('step-otp');
const messageBox = document.getElementById('message-box');
const otpMessage = document.getElementById('otp-message');
const companyName = document.getElementById('company-name');
const loginHeading = document.getElementById('login-heading');
const loginSubtitle = document.getElementById('login-subtitle');

let currentPhone = '';
let currentLocalPhone = '';
let currentCountryCode = '';
let authMode = 'employee';
const REQUEST_TIMEOUT_MS = 20000;

const params = new URLSearchParams(window.location.search);
const returnTo = params.get('return_to');

function showMessage(text, type = 'success') {
    messageBox.textContent = text;
    messageBox.className = type;
    messageBox.classList.remove('hidden');
}

function hideMessage() {
    messageBox.classList.add('hidden');
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

        const data = await res.json();

        if (res.ok) {
            currentPhone = fullPhoneNumber;
            currentLocalPhone = phone;
            currentCountryCode = countryCode;
            otpMessage.textContent = `Code sent to ${countryCode}${phone}`;
            stepPhone.classList.remove('active');
            stepOtp.classList.add('active');
            otpInput.focus();
        } else {
            if (res.status === 403 && authMode !== 'referral') {
                showMessage('WhatsApp number not registered.', 'error');
            } else {
                showMessage(data.error || 'Failed to send code.', 'error');
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showMessage('Request timed out. Please try again.', 'error');
        } else {
            showMessage('Network error. Please try again.', 'error');
        }
    } finally {
        btnSend.disabled = false;
        btnSend.textContent = 'Continue';
    }
});

btnVerify.addEventListener('click', async () => {
    const code = otpInput.value.trim();
    if (!code) {
        showMessage('Please enter the 6-digit code.', 'error');
        return;
    }

    hideMessage();
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

        const data = await res.json();

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
            showMessage(data.error || 'Invalid code.', 'error');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showMessage('Request timed out. Please try again.', 'error');
        } else {
            showMessage('Network error. Please try again.', 'error');
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
});

phoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnSend.click();
});

otpInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnVerify.click();
});

loadAuthContext();
