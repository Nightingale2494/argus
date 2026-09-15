from datetime import datetime, timezone
import uuid
from typing import Any
from app.schemas.canonical import (
    VerificationMode,
    VerificationResultRead,
    VerificationSource,
    VerificationStatus,
)
from app.verification.providers.base import BaseVerificationProvider


class DemoProvider(BaseVerificationProvider):
    """Deterministic SIH demo mode provider supporting flagship profiles (ALPHA, BHARAT, CREST)."""

    def __init__(self, domain: str, source: VerificationSource, mode: VerificationMode = VerificationMode.DEMO):
        self.domain = domain.lower()
        self._source = source
        self._mode = mode

    @property
    def mode(self) -> VerificationMode:
        if self.domain in ("epfo", "esic"):
            return VerificationMode.CONFIGURED_UNVERIFIED
        return self._mode

    @property
    def source(self) -> VerificationSource:
        return self._source

    async def verify(
        self, bidder_data: dict[str, Any], field: str
    ) -> VerificationResultRead:
        now = datetime.now(timezone.utc)
        ver_id = str(uuid.uuid4())
        bidder_id = bidder_data.get("id", "UNKNOWN_BIDDER")
        bidder_name = bidder_data.get("bidder_name", "").upper()
        simulated_outcome = (bidder_data.get("simulated_outcome") or "success").lower()

        # Check for unconfigured statutory registries (EPFO / ESIC)
        if self.domain in ("epfo", "esic"):
            return VerificationResultRead(
                id=ver_id,
                bidder_id=bidder_id,
                field=field,
                claimed_value=bidder_data.get("gstin") or bidder_name,
                verified_value=None,
                status=VerificationStatus.UNAVAILABLE,
                source=self.source,
                mode=VerificationMode.CONFIGURED_UNVERIFIED,
                provider_mode="CONFIGURED_UNVERIFIED",
                is_synthetic=False,
                checked_at=now,
                verification_reference=f"STUB-{self.domain.upper()}-UNCONFIGURED",
                error_message=f"External statutory credentials for {self.domain.upper()} are not configured. Marked unverified.",
            )

        # Handle specific simulated edge cases if passed in tests
        if simulated_outcome == "timeout":
            return VerificationResultRead(
                id=ver_id,
                bidder_id=bidder_id,
                field=field,
                claimed_value=bidder_data.get("gstin") or bidder_name,
                verified_value=None,
                status=VerificationStatus.TIMEOUT,
                source=self.source,
                mode=self.mode,
                provider_mode="DEMO_SYNTHETIC",
                is_synthetic=True,
                checked_at=now,
                error_message=f"Simulated timeout in DEMO mode for domain '{self.domain}'",
            )

        if simulated_outcome == "unavailable":
            return VerificationResultRead(
                id=ver_id,
                bidder_id=bidder_id,
                field=field,
                claimed_value=bidder_data.get("gstin") or bidder_name,
                verified_value=None,
                status=VerificationStatus.UNAVAILABLE,
                source=self.source,
                mode=self.mode,
                provider_mode="DEMO_SYNTHETIC",
                is_synthetic=True,
                checked_at=now,
                error_message=f"Simulated unavailability in DEMO mode for domain '{self.domain}'",
            )

        # Flagship Profile 1: ALPHA (Full Compliance Match)
        if "ALPHA" in bidder_name or "ACME" in bidder_name:
            if self.domain == "blacklist" or "debarment" in field.lower() or "blacklisted" in field.lower():
                c_val = False
                v_val = False
            elif self.domain == "gst" or "gst" in field.lower():
                c_val = bidder_data.get("gstin") or "07AABCA1234H1Z9"
                v_val = c_val
            elif self.domain == "udyam" or "udyam" in field.lower():
                c_val = bidder_data.get("udyam_number") or "UDYAM-DL-07-0012345"
                v_val = c_val
            elif self.domain == "mca" or "cin" in field.lower():
                c_val = bidder_data.get("cin") or "U72200DL2018PTC123456"
                v_val = c_val
            elif "turnover" in field.lower():
                c_val = 150000000
                v_val = 150000000
            else:
                c_val = bidder_name
                v_val = bidder_name

            return VerificationResultRead(
                id=ver_id,
                bidder_id=bidder_id,
                field=field,
                claimed_value=c_val,
                verified_value=v_val,
                status=VerificationStatus.VERIFIED,
                source=self.source,
                mode=self.mode,
                provider_mode="DEMO_SYNTHETIC",
                is_synthetic=True,
                checked_at=now,
                verification_reference=f"DEMO-ALPHA-{self.domain.upper()}-8819",
                metadata_json={
                    "profile": "ALPHA_FLAGSHIP",
                    "status": "ACTIVE",
                    "verified_entity": bidder_data.get("bidder_name"),
                    "valid": True,
                },
            )

        # Flagship Profile 2: BHARAT (Verified Turnover Lower than Claimed)
        if "BHARAT" in bidder_name:
            if "turnover" in field.lower():
                return VerificationResultRead(
                    id=ver_id,
                    bidder_id=bidder_id,
                    field=field,
                    claimed_value=150000000,
                    verified_value=85000000,  # 8.5 Cr verified vs 15 Cr claimed -> lower than 10 Cr requirement
                    status=VerificationStatus.MISMATCH,
                    source=self.source,
                    mode=self.mode,
                    provider_mode="DEMO_SYNTHETIC",
                    is_synthetic=True,
                    checked_at=now,
                    verification_reference="DEMO-BHARAT-TURNOVER-LOWER",
                    error_message="CA verified turnover (INR 8.5 Cr) is lower than claimed (INR 15 Cr)",
                    metadata_json={"currency": "INR"},
                )
            if self.domain == "blacklist" or "debarment" in field.lower():
                c_val = False
                v_val = False
            elif self.domain == "gst" or "gst" in field.lower():
                c_val = bidder_data.get("gstin") or "29AAFBB5678K1Z3"
                v_val = c_val
            elif self.domain == "udyam" or "udyam" in field.lower():
                c_val = bidder_data.get("udyam_number") or "UDYAM-KA-29-0045678"
                v_val = c_val
            else:
                c_val = bidder_name
                v_val = bidder_name

            return VerificationResultRead(
                id=ver_id,
                bidder_id=bidder_id,
                field=field,
                claimed_value=c_val,
                verified_value=v_val,
                status=VerificationStatus.VERIFIED,
                source=self.source,
                mode=self.mode,
                provider_mode="DEMO_SYNTHETIC",
                is_synthetic=True,
                checked_at=now,
                verification_reference=f"DEMO-BHARAT-{self.domain.upper()}-1024",
                metadata_json={
                    "profile": "BHARAT_FLAGSHIP",
                    "status": "ACTIVE",
                    "verified_entity": bidder_data.get("bidder_name"),
                },
            )

        # Flagship Profile 3: CREST (Suspicious OEM / Conflicting Verification -> REVIEW_REQUIRED)
        if "CREST" in bidder_name or "MALICIOUS" in bidder_name:
            if self.domain == "blacklist" or "debarment" in field.lower() or "blacklisted" in field.lower() or "MALICIOUS" in bidder_name:
                return VerificationResultRead(
                    id=ver_id,
                    bidder_id=bidder_id,
                    field=field,
                    claimed_value=False,
                    verified_value={"debarred": True, "reason": "Debarred by CPP Portal for submission of forged OEM certificate"},
                    status=VerificationStatus.MISMATCH,
                    source=self.source,
                    mode=self.mode,
                    provider_mode="DEMO_SYNTHETIC",
                    is_synthetic=True,
                    checked_at=now,
                    verification_reference="DEMO-CREST-DEBARRED",
                    error_message="Listed in Central Debarment Directory for OEM fraud",
                    metadata_json={
                        "debarred": True,
                        "reason": "Debarred by CPP Portal for submission of forged OEM certificate",
                    },
                )
            if self.domain == "udyam" or "udyam" in field.lower():
                return VerificationResultRead(
                    id=ver_id,
                    bidder_id=bidder_id,
                    field=field,
                    claimed_value=None,
                    verified_value=None,
                    status=VerificationStatus.NOT_FOUND,
                    source=self.source,
                    mode=self.mode,
                    provider_mode="DEMO_SYNTHETIC",
                    is_synthetic=True,
                    checked_at=now,
                    verification_reference="DEMO-CREST-UDYAM-NOT-FOUND",
                    error_message="Udyam registration not found for Crest Solutions",
                )
            if "LOGISTICS" in bidder_name or (bidder_data.get("gstin") and bidder_data.get("gstin", "").endswith("199")):
                return VerificationResultRead(
                    id=ver_id,
                    bidder_id=bidder_id,
                    field=field,
                    claimed_value=bidder_data.get("gstin") or bidder_name,
                    verified_value="27AAAAA0000A1Z5",
                    status=VerificationStatus.MISMATCH,
                    source=self.source,
                    mode=self.mode,
                    provider_mode="DEMO_SYNTHETIC",
                    is_synthetic=True,
                    checked_at=now,
                    verification_reference="DEMO-CREST-GST-MISMATCH",
                    error_message="GSTIN legal name mismatch against central GST portal",
                )
            if self.domain == "gst" or "gst" in field.lower():
                c_val = bidder_data.get("gstin") or "27AABCC9876D1Z7"
                v_val = c_val
            else:
                c_val = bidder_name
                v_val = bidder_name

            return VerificationResultRead(
                id=ver_id,
                bidder_id=bidder_id,
                field=field,
                claimed_value=c_val,
                verified_value=v_val,
                status=VerificationStatus.VERIFIED,
                source=self.source,
                mode=self.mode,
                provider_mode="DEMO_SYNTHETIC",
                is_synthetic=True,
                checked_at=now,
                verification_reference=f"DEMO-CREST-{self.domain.upper()}-5521",
                metadata_json={
                    "profile": "CREST_FLAGSHIP",
                },
            )

        # Default fallback demo verification
        return VerificationResultRead(
            id=ver_id,
            bidder_id=bidder_id,
            field=field,
            claimed_value=bidder_data.get("gstin") or bidder_name,
            verified_value={
                "status": "ACTIVE",
                "verified_entity": bidder_data.get("bidder_name"),
            },
            status=VerificationStatus.VERIFIED,
            source=self.source,
            mode=self.mode,
            provider_mode="DEMO_SYNTHETIC",
            is_synthetic=True,
            checked_at=now,
            verification_reference=f"DEMO-GENERIC-{self.domain.upper()}-{uuid.uuid4().hex[:6].upper()}",
        )
