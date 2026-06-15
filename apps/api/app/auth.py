from fastapi import Header, HTTPException, status

from .config import settings


async def require_access_token(x_drec_access_token: str = Header(default="")) -> None:
    if not settings.drec_access_token:
        return
    if x_drec_access_token != settings.drec_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid DREC access token is required.",
        )
