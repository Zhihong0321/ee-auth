const phoneInput = document.getElementById('phone');
const otpInput = document.getElementById('otp');
const btnSend = document.getElementById('btn-send-otp');
const btnVerify = document.getElementById('btn-verify-otp');
const btnBack = document.getElementById('btn-back');
const stepPhone = document.getElementById('step-phone');
const stepOtp = document.getElementById('step-otp');
const messageBox = document.getElementById('message-box');
const otpMessage = document.getElementById('otp-message');

let currentPhone = '';

// Helper to show message
function showMessage(text, type = 'success') {
    messageBox.textContent = text;
    messageBox.className = type;
    messageBox.classList.remove('hidden');
}

function hideMessage() {
    messageBox.classList.add('hidden');
}

// Step 1: Send OTP
btnSend.addEventListener('click', async () => {
    const phone = phoneInput.value.trim();
    if (!phone) {
        showMessage('Please enter your mobile number.', 'error');
        return;
    }

    // Basic client-side validation (ensure digits)
    if (!/^\d+$/.test(phone)) {
        showMessage('Please enter numbers only.', 'error');
        return;
    }

    hideMessage();
    btnSend.disabled = true;
    btnSend.textContent = 'Sending...';

    try {
        const res = await fetch('/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phone })
        });

        const data = await res.json();

        if (res.ok) {
            currentPhone = phone;
            otpMessage.textContent = `Code sent to +60${phone}`;
            stepPhone.classList.remove('active');
            stepOtp.classList.add('active');
            otpInput.focus();
        } else {
            if (res.status === 403) {
                showMessage('WhatsApp number not registered.', 'error');
            } else {
                showMessage(data.error || 'Failed to send code.', 'error');
            }
        }
    } catch (err) {
        showMessage('Network error. Please try again.', 'error');
    } finally {
        btnSend.disabled = false;
        btnSend.textContent = 'Send Verification Code';
    }
});

// Step 2: Verify OTP
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
        const res = await fetch('/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: currentPhone, code })
        });

        const data = await res.json();

        if (res.ok) {
            showMessage('Authentication successful! Redirecting...', 'success');
            
            // Handle Redirect
            const params = new URLSearchParams(window.location.search);
            const returnTo = params.get('return_to');
            
            setTimeout(() => {
                if (returnTo) {
                    window.location.href = decodeURIComponent(returnTo);
                } else {
                    // Default fallback if no return_to provided
                    window.location.href = '/auth/me'; // Or some dashboard
                }
            }, 1000);
        } else {
            showMessage(data.error || 'Invalid code.', 'error');
        }
    } catch (err) {
        showMessage('Network error. Please try again.', 'error');
    } finally {
        btnVerify.disabled = false;
        btnVerify.textContent = 'Login';
    }
});

// Back Button
btnBack.addEventListener('click', () => {
    stepOtp.classList.remove('active');
    stepPhone.classList.add('active');
    hideMessage();
});

// Enter key support
phoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnSend.click();
});
otpInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnVerify.click();
});
