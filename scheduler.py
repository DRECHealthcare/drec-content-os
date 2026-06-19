import csv
import time
from datetime import datetime
from pathlib import Path

from post import MetaPostError, post_facebook, post_instagram

POSTS_FILE = Path("posts.csv")
DATE_FORMAT = "%Y-%m-%d %H:%M"


def _read_posts() -> list[dict[str, str]]:
    if not POSTS_FILE.exists():
        return []
    with POSTS_FILE.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _write_posts(rows: list[dict[str, str]]) -> None:
    fieldnames = ["date_time", "platform", "message", "image_url", "status"]
    with POSTS_FILE.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _is_due(row: dict[str, str], now: datetime) -> bool:
    try:
        scheduled_at = datetime.strptime(row.get("date_time", "").strip(), DATE_FORMAT)
    except ValueError:
        return False
    return scheduled_at <= now


def process_due_posts() -> None:
    rows = _read_posts()
    changed = False
    now = datetime.now()
    for row in rows:
        if row.get("status", "").strip().lower() != "pending" or not _is_due(row, now):
            continue
        platform = row.get("platform", "").strip().lower()
        message = row.get("message", "")
        image_url = row.get("image_url", "").strip() or None
        try:
            if platform == "facebook":
                result = post_facebook(message, image_url=image_url)
            elif platform == "instagram":
                if not image_url:
                    raise MetaPostError("Instagram posts require image_url.")
                result = post_instagram(image_url, message)
            else:
                raise MetaPostError(f"Unsupported platform: {platform}")
            row["status"] = "posted"
            changed = True
            print(f"Posted {platform}: {result}")
        except Exception as error:
            row["status"] = f"error: {error}"
            changed = True
            print(f"Failed {platform}: {error}")
    if changed:
        _write_posts(rows)


def main() -> None:
    print("DREC Meta scheduler started. Checking every 10 minutes.")
    while True:
        process_due_posts()
        time.sleep(600)


if __name__ == "__main__":
    main()
