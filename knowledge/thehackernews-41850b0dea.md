Rust Supply Chain Attack via Compromised Crate Maintainer Accounts

Three popular Rust crates (arrayref, internment, append-only-vec) with combined 245 million downloads were compromised when a maintainer account was hijacked to publish malicious versions. The compromised releases introduced typosquatted dependencies that executed remote payloads during the build process, affecting developers who updated to those specific versions.
