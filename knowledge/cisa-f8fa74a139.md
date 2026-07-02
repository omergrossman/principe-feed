FUXA SCADA/HMI Authentication Bypass Vulnerability (CVE-2026-13207)

Frangoteam FUXA SCADA/HMI versions 1.3.1 and earlier contain an authentication bypass vulnerability in the REST API that allows unauthenticated remote attackers to enumerate user accounts and role assignments through path normalization techniques. The vulnerability exploits improper handling of dot-segment sequences, enabling unauthorized access to protected endpoints. CISA recommends immediate patching to version 1.3.2 or later and implementing network segmentation for affected critical infrastructure systems.
