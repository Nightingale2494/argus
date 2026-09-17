from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.audit.logger import AuditLogger
from app.auth.dependencies import get_current_principal
from app.db.session import get_db
from app.schemas.canonical import AuthenticatedPrincipal

router = APIRouter(tags=["Auth"])


@router.get("/auth/me", response_model=AuthenticatedPrincipal)
def get_current_user_profile(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> AuthenticatedPrincipal:
    """Returns profile and active role of the currently authenticated principal."""
    return principal


@router.post("/auth/login-event")
def record_login_event(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Server-verified endpoint to record authoritative LOGIN_SUCCESS for an authenticated principal."""
    user_display = principal.full_name or principal.name or principal.user_id
    AuditLogger.log(
        db=db,
        action="LOGIN_SUCCESS",
        entity_type="USER",
        entity_id=principal.user_id,
        principal=principal,
        payload={
            "actor_user_id": principal.user_id,
            "actor_name": user_display,
            "actor_email": principal.email,
            "message": f"User '{user_display}' ({principal.email or 'no email'}) authenticated successfully.",
        },
    )
    return {
        "status": "ok",
        "user_id": principal.user_id,
        "full_name": principal.full_name or principal.name,
        "email": principal.email,
    }
