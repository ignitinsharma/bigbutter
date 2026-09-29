from fastapi import APIRouter, Response, Request, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from core.auth import verify_password, issue_token

router = APIRouter(prefix="/auth")

class LoginIn(BaseModel):
    email: str
    password: str

@router.post("/login")
async def login(body: LoginIn, resp: Response, s: AsyncSession = Depends(get_session)):
    row = (await s.execute(text("SELECT id, password_hash FROM users WHERE lower(email)=lower(:e)"), {"e": body.email})).mappings().first()
    if not row or not verify_password(body.password, row["password_hash"]):
        resp.status_code = 401
        return {"error": "bad credentials"}
    resp.set_cookie("session", issue_token(str(row["id"])), httponly=True, samesite="lax", path="/")
    return {"ok": True}

@router.post("/logout")
async def logout(resp: Response):
    resp.delete_cookie("session", path="/")
    return {"ok": True}
