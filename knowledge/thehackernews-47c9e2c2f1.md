Critical Authentication Bypass in Canonical LXD and MicroCloud

A CVSS 10.0 vulnerability in Canonical's LXD and MicroCloud allows attackers to authenticate as trusted clients without possessing their private keys, requiring only network access to the HTTPS API and knowledge of the target's public certificate. Successful exploitation grants the attacker full cluster and virtual machine access under the impersonated account's privileges.
