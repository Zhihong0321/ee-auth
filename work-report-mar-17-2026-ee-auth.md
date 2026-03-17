DATE  : Mar 17, 2026
REPO NAME : EE-auth

- Switched OTP delivery to the new Baileys WhatsApp server and eternalgy-auth session
- Added WhatsApp session recovery checks before OTP sends to handle Baileys restart-required states
- Verified the new Baileys send endpoint live and removed false session blocking before OTP sends

=====================
