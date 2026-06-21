from typing import Any, Dict, List, Optional

import httpx

from .config import settings


def configured() -> bool:
    return bool(settings.supabase_url and api_key())


def api_key() -> Optional[str]:
    return settings.supabase_service_role_key or settings.supabase_api_key


def headers(prefer: Optional[str] = None) -> Dict[str, str]:
    key = api_key() or ""
    out = {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "content-type": "application/json",
    }
    if prefer:
        out["prefer"] = prefer
    return out


def table_url(table: str) -> str:
    return f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"


async def select(table: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    if not configured():
        return []
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(table_url(table), headers=headers(), params=params)
        res.raise_for_status()
        return res.json()


async def insert(table: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not configured():
        return None
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            table_url(table),
            headers=headers("return=representation"),
            json=payload,
        )
        res.raise_for_status()
        data = res.json()
        return data[0] if data else None


async def update(
    table: str,
    payload: Dict[str, Any],
    params: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    if not configured():
        return None
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.patch(
            table_url(table),
            headers=headers("return=representation"),
            params=params,
            json=payload,
        )
        res.raise_for_status()
        data = res.json()
        return data[0] if data else None


async def count(table: str) -> int:
    if not configured():
        return 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.get(
                table_url(table),
                headers={**headers(), "prefer": "count=exact"},
                params={"select": "id", "limit": "0"},
            )
            res.raise_for_status()
            content_range = res.headers.get("content-range", "0-0/0")
            return int(content_range.rsplit("/", 1)[-1])
    except (httpx.HTTPError, ValueError):
        return 0


async def count_strict(table: str) -> int:
    if not configured():
        raise RuntimeError("Supabase REST is not configured.")
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            table_url(table),
            headers={**headers(), "prefer": "count=exact"},
            params={"select": "id", "limit": "0"},
        )
        res.raise_for_status()
        content_range = res.headers.get("content-range", "0-0/0")
        return int(content_range.rsplit("/", 1)[-1])
