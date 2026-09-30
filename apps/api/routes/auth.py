# auth routes: login, logout, no small talk.
from fastapi import APIRouter, Response, Request, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import get_session
from core.auth import verify_password, issue_token, read_token

router = APIRouter(prefix="/auth")

class LoginIn(BaseModel):
    email: str
    password: str

@router.post("/login")
async def login(body: LoginIn, resp: Response, s: AsyncSession = Depends(get_session)):
    # Verify email+password; on success set the session cookie, else 401.
    row = (await s.execute(text("SELECT id, password_hash FROM users WHERE lower(email)=lower(:e)"), {"e": body.email})).mappings().first()
    if not row or not verify_password(body.password, row["password_hash"]):
        resp.status_code = 401
        return {"error": "bad credentials"}
    resp.set_cookie("session", issue_token(str(row["id"])), httponly=True, samesite="lax", path="/")
    return {"ok": True}

@router.post("/logout")
async def logout(resp: Response):
    # Clear the session cookie to end this browser's login.
    resp.delete_cookie("session", path="/")
    return {"ok": True}

@router.get("/me")
async def whoami(req: Request, resp: Response, s: AsyncSession = Depends(get_session)):
    # Return the logged-in user's email from the session cookie, or 401.
    uid = read_token(req.cookies.get("session", ""))
    row = (await s.execute(text("SELECT email FROM users WHERE id=:i"), {"i": uid})).mappings().first() if uid else None
    if not row:
        resp.status_code = 401
        return {"error": "unauthorized"}
    return {"email": row["email"]}
