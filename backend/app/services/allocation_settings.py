from __future__ import annotations

from pydantic import BaseModel, Field


class Rule(BaseModel):
    id: str = Field(max_length=64)
    name: str = Field(max_length=100)
    enabled: bool = True
    account_id: str = Field(max_length=36)
    folder_id: str | None = Field(default=None, max_length=128)
    folder_name: str | None = Field(default=None, max_length=1024)
    extensions: list[str] = Field(default_factory=list, max_length=50)
    mime_prefixes: list[str] = Field(default_factory=list, max_length=20)
    name_contains: str | None = Field(default=None, max_length=200)


class FolderDefault(BaseModel):
    folder_id: str | None = None
    folder_name: str | None = None


class AllocationSettings(BaseModel):
    safety_margin_mb: int = Field(default=512, ge=0, le=1024 * 1024)
    priority: list[str] = Field(default_factory=list, max_length=100)
    rules: list[Rule] = Field(default_factory=list, max_length=100)
    account_defaults: dict[str, FolderDefault] = Field(default_factory=dict)
