F5 BIG-IP APM Malware Employs In-Memory PHP Web Shell to Evade Detection

Sophos researchers identified malware targeting F5 BIG-IP Access Policy Manager appliances that injects a PHP web shell into memory rather than writing to disk, allowing it to bypass file-based detection mechanisms. The attack leverages Apache's script loading process to inject the payload into memory while keeping disk artifacts clean, enabling persistence while remaining hidden from conventional scans.
