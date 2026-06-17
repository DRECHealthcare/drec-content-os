from fastapi import Header, HTTPException, status

from .config import settings


ROLE_SCOPES = {
    "viewer": ["read", "export"],
    "reviewer": ["read", "export", "review"],
    "operator": ["read", "export", "review", "schedule", "metrics"],
    "admin": ["read", "export", "review", "schedule", "metrics", "admin"],
}


def configured_role_tokens():
    tokens = {}
    if settings.drec_viewer_token:
        tokens[settings.drec_viewer_token] = "viewer"
    if settings.drec_reviewer_token:
        tokens[settings.drec_reviewer_token] = "reviewer"
    if settings.drec_operator_token:
        tokens[settings.drec_operator_token] = "operator"
    if settings.drec_admin_token:
        tokens[settings.drec_admin_token] = "admin"
    if settings.drec_access_token:
        tokens.setdefault(settings.drec_access_token, "admin")
    return tokens


def access_policy_payload(current_role="none"):
    role_tokens = configured_role_tokens()
    configured_roles = sorted(set(role_tokens.values()))
    legacy_enabled = bool(settings.drec_access_token)
    return {
        "mode": "role_tokens" if configured_roles else "open_local" if not legacy_enabled else "legacy_token",
        "current_role": current_role,
        "current_scopes": ROLE_SCOPES.get(current_role, []),
        "configured_roles": configured_roles,
        "legacy_access_token_enabled": legacy_enabled,
        "recommended_roles": [
            {
                "role": role,
                "scopes": scopes,
            }
            for role, scopes in ROLE_SCOPES.items()
        ],
        "setup_env": ["DREC_VIEWER_TOKEN", "DREC_REVIEWER_TOKEN", "DREC_OPERATOR_TOKEN", "DREC_ADMIN_TOKEN"],
        "notes": [
            "Existing DREC_ACCESS_TOKEN remains accepted as admin for backward compatibility.",
            "Use reviewer tokens for asset and queue review handoff.",
            "Use operator tokens for scheduling, publishing handoff, and metrics closeout.",
            "Keep admin token limited to setup, deployment, and security changes.",
        ],
    }


async def require_access_token(x_drec_access_token: str = Header(default="")) -> dict:
    role_tokens = configured_role_tokens()
    if not role_tokens:
        return {"role": "admin", "scopes": ROLE_SCOPES["admin"], "mode": "open_local"}
    role = role_tokens.get(x_drec_access_token)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid DREC access token is required.",
        )
    return {"role": role, "scopes": ROLE_SCOPES[role], "mode": "role_tokens"}
