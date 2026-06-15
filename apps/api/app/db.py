from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import asyncpg

from .config import settings


pool: Optional[asyncpg.Pool] = None


async def connect_db() -> None:
    global pool
    if settings.database_url and pool is None:
        pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=5)


async def close_db() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None


@asynccontextmanager
async def connection():
    if pool is None:
        yield None
        return
    async with pool.acquire() as conn:
        yield conn


async def fetch_rows(query: str, *args: Any) -> List[Dict[str, Any]]:
    async with connection() as conn:
        if conn is None:
            return []
        rows = await conn.fetch(query, *args)
        return [dict(row) for row in rows]


async def fetch_row(query: str, *args: Any) -> Optional[Dict[str, Any]]:
    async with connection() as conn:
        if conn is None:
            return None
        row = await conn.fetchrow(query, *args)
        return dict(row) if row else None
