OpenSSL HollowByte Flaw Enables Memory Exhaustion via Minimal TLS Requests

A vulnerability in OpenSSL allows attackers to allocate up to 131 KB of memory per malformed 11-byte TLS request, potentially exhausting server resources. The flaw was silently patched in June without CVE assignment or public advisory. Okta's security team discovered and disclosed the denial-of-service issue, affecting glibc-based systems until process restart.
