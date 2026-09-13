# Government GeM Enterprise Identity Provider (IdP) Integration Roadmap

## Overview

ARGUS is designed to integrate seamlessly with the Government e-Marketplace (GeM) Single Sign-On (SSO) infrastructure, Parichay (National Single Sign-On for Government of India), and standard OpenID Connect (OIDC) / OAuth 2.0 enterprise identity providers.

During hackathons and local development, ARGUS supports an isolated mock/dev token workflow (`ARGUS_AUTH_MODE=hackathon`). In government staging and production deployments, ARGUS operates in strict enterprise mode (`ARGUS_AUTH_MODE=oidc`), which completely disables synthetic token minting and enforces cryptographic token validation via remote JWKS.

---

## Architecture Diagram

```
+-------------------+           +-------------------+           +-------------------+
|                   |  1. Auth  |                   |  2. Token |                   |
|   Browser / GeM   | --------> |    Parichay /     | --------> |   ARGUS Web App   |
|   Procurement     |           |    GeM SSO (IdP)  |           |   (Next.js App)   |
|   Officer Portal  |           |                   |           |                   |
+-------------------+           +-------------------+           +-------------------+
                                                                          |
                                                                          | 3. Bearer JWT
                                                                          v
+-------------------+           +-------------------+           +-------------------+
|   Jwks Endpoint   | <-------- | ARGUS FastAPI API | <-------- | Client HTTP / API |
|   (Public Keys)   | 4. Verify | Backend Service   |           | Requests          |
+-------------------+           +-------------------+           +-------------------+
```

---

## Mode Configuration

ARGUS authorization behavior is governed by environment variables:

| Variable | Values | Purpose | Default |
| :--- | :--- | :--- | :--- |
| `ARGUS_AUTH_MODE` | `hackathon`, `oidc`, `enterprise` | Selects identity validation path | `hackathon` |
| `OIDC_ISSUER_URL` | `https://sso.gem.gov.in/auth/realms/gem` | Base discovery URL (`.well-known/openid-configuration`) | None |
| `OIDC_CLIENT_ID` | `argus-procurement-core` | GeM registered application client ID | None |
| `OIDC_CLIENT_SECRET` | Secure credential | OAuth2 client secret for token introspection | None |
| `OIDC_JWKS_URI` | `https://sso.gem.gov.in/auth/realms/gem/protocol/openid-connect/certs` | Public keys for JWT signature validation | None |
| `OIDC_AUDIENCE` | `argus-api` | Expected JWT `aud` claim | None |

---

## Role Mapping Specification

GeM / Parichay returns government employee designation and role mappings in SAML attributes or OIDC claims (e.g. `realm_access.roles` or `designation`). ARGUS maps these dynamically to authoritative system roles:

| GeM / Parichay Role / Designation | ARGUS Internal Role | Capabilities |
| :--- | :--- | :--- |
| `HOD`, `Buyer-Admin`, `Tender-Inviting-Authority` | `ADMIN` | Full tenant management, requirements override, audit signoff |
| `Procurement-Officer`, `Evaluation-Committee-Member` | `PROCUREMENT_OFFICER` | Record authoritative qualification/disqualification decisions |
| `Technical-Evaluator`, `Bid-Scrutiny-Officer` | `REVIEWER` | View evaluations, run Deep Audit, submit review recommendations |
| `CAG-Auditor`, `Vigilance-Officer`, `Third-Party-Auditor` | `AUDITOR` | Read-only tamper-evident audit trail & cryptographic snapshot verification |

---

## Fail-Closed Security Guarantees

1. **Gate 0 Enforcement**: When `ARGUS_AUTH_MODE=oidc`, the `/api/auth/dev-token` route unconditionally returns HTTP 403 Forbidden.
2. **Signature Verification**: Live tokens are validated against current RSA/ECDSA public keys retrieved from the government IdP's JWKS endpoint with automated 24-hour key caching and rotation.
3. **Replay & Expiry Protection**: Replay attacks are mitigated by requiring valid `nonce` and strict `exp` expiration times (\(\le 15 \text{ minutes}\)).
4. **Tenant Isolation**: Token claims include `org_id` and `department_id`, scoping all tender queries strictly to authorized government ministries.
