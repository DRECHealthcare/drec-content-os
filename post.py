import os
import time
from typing import Any, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v23.0")
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

PAGE_ID = os.getenv("PAGE_ID") or os.getenv("META_PAGE_ID")
IG_USER_ID = os.getenv("IG_USER_ID") or os.getenv("META_IG_USER_ID")
PAGE_TOKEN = os.getenv("PAGE_TOKEN") or os.getenv("META_PAGE_ACCESS_TOKEN")


class MetaPostError(RuntimeError):
    pass


def _require_env() -> None:
    missing = []
    if not PAGE_ID:
        missing.append("PAGE_ID")
    if not IG_USER_ID:
        missing.append("IG_USER_ID")
    if not PAGE_TOKEN:
        missing.append("PAGE_TOKEN")
    if missing:
        raise MetaPostError(f"Missing required env value(s): {', '.join(missing)}")


def _meta_request(
    method: str,
    url: str,
    *,
    data: Optional[dict[str, Any]] = None,
    params: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    last_error: Optional[Exception] = None
    for attempt in range(1, 4):
        try:
            response = requests.request(method, url, data=data, params=params, timeout=30)
            payload = response.json() if response.content else {}
            if response.ok and "error" not in payload:
                return payload
            message = payload.get("error", {}).get("message") or response.text
            raise MetaPostError(f"Meta API error {response.status_code}: {message}")
        except (requests.RequestException, ValueError, MetaPostError) as error:
            last_error = error
            if attempt == 3:
                break
            time.sleep(30 * attempt)
    raise MetaPostError(str(last_error))


def post_facebook(message: str, image_url: Optional[str] = None, scheduled_ts: Optional[int] = None) -> dict[str, Any]:
    """
    Publish a Facebook Page text post, image post, or scheduled post.

    scheduled_ts must be a Unix timestamp. Meta requires scheduled posts to be
    unpublished at creation, so this function sets published=false automatically.
    """
    _require_env()
    endpoint = "photos" if image_url else "feed"
    data: dict[str, Any] = {
        "access_token": PAGE_TOKEN,
        "message": message,
    }
    if image_url:
        data["url"] = image_url
        if scheduled_ts:
            data["published"] = "false"
            data["scheduled_publish_time"] = str(int(scheduled_ts))
    elif scheduled_ts:
        data["published"] = "false"
        data["scheduled_publish_time"] = str(int(scheduled_ts))
    return _meta_request("POST", f"{GRAPH_BASE}/{PAGE_ID}/{endpoint}", data=data)


def _wait_for_instagram_container(container_id: str) -> None:
    status_url = f"{GRAPH_BASE}/{container_id}"
    deadline = time.time() + 60
    while time.time() < deadline:
        data = _meta_request(
            "GET",
            status_url,
            params={"fields": "status_code,status", "access_token": PAGE_TOKEN},
        )
        status_code = data.get("status_code")
        if status_code == "FINISHED":
            return
        if status_code in {"ERROR", "EXPIRED"}:
            raise MetaPostError(f"Instagram container failed: {data}")
        time.sleep(5)
    raise MetaPostError("Instagram container was not ready after 60 seconds.")


def post_instagram(image_url: str, caption: str) -> dict[str, Any]:
    """Publish an Instagram image post through create-container then media_publish."""
    _require_env()
    create_data = _meta_request(
        "POST",
        f"{GRAPH_BASE}/{IG_USER_ID}/media",
        data={
            "image_url": image_url,
            "caption": caption,
            "access_token": PAGE_TOKEN,
        },
    )
    container_id = create_data.get("id")
    if not container_id:
        raise MetaPostError(f"Meta did not return an Instagram container id: {create_data}")
    _wait_for_instagram_container(container_id)
    return _meta_request(
        "POST",
        f"{GRAPH_BASE}/{IG_USER_ID}/media_publish",
        data={"creation_id": container_id, "access_token": PAGE_TOKEN},
    )


if __name__ == "__main__":
    result = post_facebook("测试发帖内容")
    print(result)
