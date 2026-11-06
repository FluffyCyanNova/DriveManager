from __future__ import annotations
from sqlalchemy.orm import Session
from app.database.models import AppSetting


def get_setting(db: Session, key: str, default=None):
    row = db.get(AppSetting, key)
    return row.value if row else default


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    db.commit()
