OpenSSL Patches High-Severity DTLS Memory Leak Vulnerability

OpenSSL released fixes for a high-severity flaw in DTLS (Datagram TLS) that can expose heap memory to remote endpoints or trigger application crashes. The vulnerability occurs when handshake message retransmission is initiated while a larger message is partially processed, creating conditions for memory disclosure or denial of service.
