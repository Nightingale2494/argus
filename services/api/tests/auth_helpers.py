from app.auth.tokens import create_access_token
from app.schemas.canonical import UserRole


def get_auth_headers(
    role: UserRole = UserRole.ADMIN,
    user_id: str = "test-user-001",
    name: str | None = "Test User",
    email: str | None = "test.user@argus.local",
    is_demo_operator: bool = False,
    evaluation_mode: bool = False,
) -> dict[str, str]:
    """Generates valid Authorization bearer headers for test HTTP requests."""
    token = create_access_token(
        user_id=user_id,
        role=role,
        name=name,
        email=email,
        is_demo_operator=is_demo_operator,
        evaluation_mode=evaluation_mode,
    )
    return {"Authorization": f"Bearer {token}"}
