Linux KVM Hypervisor Vulnerability Enables Guest-to-Host Escape on Intel and AMD

A use-after-free vulnerability in Linux KVM's shadow memory management unit allows a malicious guest virtual machine to corrupt the host kernel's page state. The flaw, tracked as CVE-2026-53359 and named 'Januscape', affects both Intel and AMD x86 systems and has existed for approximately 16 years. Public proof-of-concept code demonstrates host denial-of-service; the researcher indicates undisclosed variants may enable more severe compromise.
