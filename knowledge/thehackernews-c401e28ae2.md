MCP Python SDK Vulnerability Exposes OAuth Credentials to Malicious Servers

The official MCP Python SDK contained a flaw allowing malicious servers to intercept OAuth credentials including client secrets, authorization codes, and PKCE proof keys during token exchange. Affected versions transmitted sensitive authentication material to attacker-controlled endpoints. The vulnerability has been remediated in SDK version 1.30.0 and later.
