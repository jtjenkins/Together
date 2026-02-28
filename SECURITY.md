# Security Policy

## Pre-Production Warning

> **Together is pre-production software (v0.0.1). It has not been independently audited by a
> security professional.**
>
> Self-hosting is entirely at your own risk. The author makes no guarantees about the security
> of the software, and takes no responsibility for the content that users of your instance
> create or share. If you host Together for others, you are solely responsible for your
> instance and the community you run on it.
>
> Do not use Together in any context where a security breach would cause significant harm until
> a proper third-party audit has been completed.

## Known Limitations

- Rate limiting is basic (tower_governor, per-IP). A determined attacker with multiple IPs can
  still overwhelm a small server.
- File uploads are validated by magic bytes but this is not a substitute for a full
  antivirus/sandboxing pipeline.
- Voice (WebRTC) traffic is encrypted in transit, but Together does not provide end-to-end
  encryption for text messages — the server sees all message content.
- Refresh tokens are stored as bcrypt hashes; compromise of the database does not directly
  expose tokens, but the server's JWT_SECRET must be kept safe.

## Reporting a Vulnerability

If you discover a security issue, **please do not open a public GitHub issue**.

Instead, email **jordan@jordanjenkins.com** with:

1. A description of the vulnerability
2. Steps to reproduce it
3. The version or commit you tested against
4. Any suggested mitigation, if you have one

You will receive an acknowledgment within 72 hours. Fixes will be released as soon as
reasonably practical, and you will be credited (unless you prefer to remain anonymous).

## Supported Versions

Only the latest release receives security fixes at this time.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |
