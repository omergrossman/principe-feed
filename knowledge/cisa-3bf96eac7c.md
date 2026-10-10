Hitachi Energy SOI Remote Code Execution via Apache ActiveMQ

Hitachi Energy SOI versions 2.0.0 through 2.2.0 contain a code injection vulnerability in the bundled Apache ActiveMQ component that allows authenticated attackers to achieve remote code execution through improper validation of Jolokia operations. The vulnerability exploits the ability to load arbitrary Spring XML contexts via the ActiveMQ broker configuration, affecting confidentiality, integrity, and availability. Hitachi Energy has released patch EP2 to remediate the issue by upgrading ActiveMQ to version 5.19.5.
