Tailscale Patches SSH Vulnerabilities in Root-Privileged Connection Forwarding

Tailscale released version 1.104.4 to address SSH server vulnerabilities that could permit attackers to access root-restricted services and files on connected servers. The flaws exist in the SSH connection forwarding mechanism, which executes with root privileges in the Tailscale daemon. Exploitation requires prior compromise of a device within the Tailscale network.
