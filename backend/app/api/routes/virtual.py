from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_auth
from app.database.database import get_db
from app.services import virtual_folders as vf

router = APIRouter(prefix="/api/virtual-folders", tags=["virtual-folders"], dependencies=[Depends(require_auth)])


class CreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = None


class UpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: str | None = None   # include (even as null) to move the folder


class ItemRef(BaseModel):
    account_id: str
    google_file_id: str


class AddItemsBody(BaseModel):
    items: list[ItemRef] = Field(max_length=500)


class MoveItemBody(BaseModel):
    target_folder_id: str


@router.get("")
def tree(db: Session = Depends(get_db)):
    return vf.tree(db)


@router.post("")
def create(body: CreateBody, db: Session = Depends(get_db)):
    f = vf.create(db, body.name, body.parent_id)
    return {"id": f.id, "name": f.name, "parent_id": f.parent_id}


@router.patch("/{folder_id}")
def update(folder_id: str, body: UpdateBody, db: Session = Depends(get_db)):
    f = vf.update(db, folder_id, body.name, body.parent_id, move="parent_id" in body.model_fields_set)
    return {"id": f.id, "name": f.name, "parent_id": f.parent_id}


@router.delete("/{folder_id}")
def delete(folder_id: str, db: Session = Depends(get_db)):
    vf.delete(db, folder_id)
    return {"ok": True, "note": "Only the virtual folder was removed. No files in Google Drive were changed."}


@router.get("/{folder_id}/items")
def items(folder_id: str, db: Session = Depends(get_db)):
    return vf.list_items(db, folder_id)


@router.post("/{folder_id}/items")
def add_items(folder_id: str, body: AddItemsBody, db: Session = Depends(get_db)):
    return {"added": vf.add_items(db, folder_id, [i.model_dump() for i in body.items])}


@router.delete("/{folder_id}/items/{item_id}")
def remove_item(folder_id: str, item_id: str, db: Session = Depends(get_db)):
    vf.remove_item(db, folder_id, item_id)
    return {"ok": True}


@router.post("/items/{item_id}/move")
def move_item(item_id: str, body: MoveItemBody, db: Session = Depends(get_db)):
    vf.move_item(db, item_id, body.target_folder_id)
    return {"ok": True}
