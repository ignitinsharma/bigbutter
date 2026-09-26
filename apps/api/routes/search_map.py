from fastapi import APIRouter, Depends
from routes.notes import me

router = APIRouter()

@router.get("/search")
async def search(q: str, uid: str = Depends(me)):
    return {"query": q, "notes": [], "summary": "", "matched_ids": []}  # Task 4+7

@router.get("/map")
async def mmap(uid: str = Depends(me)):
    return {"nodes": [], "edges": []}  # Task 6
