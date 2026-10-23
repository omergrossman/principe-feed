Node2Shell RCE Vulnerability Demonstrated in Node.js Brotli Decoder

Imperva researchers demonstrated a remote code execution vulnerability in Node.js by crafting malicious Brotli-compressed data that exploits the bundled Brotli decoder. The proof-of-concept successfully executed arbitrary code on Node.js 24.22.0 (Linux arm64) without requiring debugging tools or custom builds. The vulnerability (CVE-2026-111497) affects the standard Node.js distribution.
