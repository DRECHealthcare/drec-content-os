from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class KnowledgeEntryIn(BaseModel):
    category: str = Field(..., examples=["brand_voice", "offer", "compliance"])
    title: str
    body: str
    tags: List[str] = []


class PublishQueueIn(BaseModel):
    channel: Literal["facebook", "instagram"]
    format: Literal["carousel", "single", "reel", "story"]
    caption: str
    media_urls: List[str] = []
    planned_slot: Optional[datetime] = None
    compliance_status: Literal["pending", "clear", "flagged"] = "pending"


class MetricIn(BaseModel):
    source: Literal["facebook", "instagram", "ads", "manual"]
    external_post_id: str
    captured_at: datetime
    metrics: Dict[str, Any]


class FeedbackIn(BaseModel):
    module: str
    ref_type: str
    ref_id: str
    action: Literal["approve", "edit", "regen", "reject"]
    reason: Optional[str] = None
    before_text: Optional[str] = None
    after_text: Optional[str] = None
    tags: List[str] = []
