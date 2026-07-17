n8n Authentication Bypass via JWT Issuer Validation Flaw

n8n's workflow automation platform contained a JWT validation vulnerability in multi-issuer Enterprise configurations that could allow unauthorized account access. The flaw caused the platform to authenticate users based solely on the subject claim while disregarding the issuer claim, enabling token substitution attacks across different identity providers.
