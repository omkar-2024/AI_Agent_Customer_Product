import json
import logging
import os
import queue
import threading
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import bcrypt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from agent.agent_loop import run_query
from callbacks.progress_tracer import ProgressTracer
from db.connection import get_connection

load_dotenv(Path(__file__).resolve().parent / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("northstar")

FIXED_RBAC_ROLES = {
    "ceo", "hr", "sales_manager", "sales_associate",
    "warehouse_manager", "warehouse_associate", "finance_manager",
    "support_associate",
}
DEFAULT_ROLE_NAME = "sales_manager"
DEFAULT_DEPARTMENT_NAME = "Sales"
DEFAULT_JOB_TITLE = "Sales Manager"
DEFAULT_ANNUAL_SALARY = os.getenv("DEFAULT_ANNUAL_SALARY", "20000")

app = FastAPI(title="Northstar Intelligence API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:5173"),
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

REPORTS_DIR = Path(os.getenv("AGENT_OUTPUT_DIR", "generated_reports")).resolve()
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=10000)


class RegistrationSyncRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=6, max_length=200)


def authenticated_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="A Supabase access token is required.")

    token = authorization.removeprefix("Bearer ").strip()
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not supabase_url or not supabase_anon_key:
        raise HTTPException(status_code=500, detail="Supabase is not configured on the backend.")

    request = Request(
        f"{supabase_url.rstrip('/')}/auth/v1/user",
        headers={"apikey": supabase_anon_key, "Authorization": f"Bearer {token}"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code in (401, 403):
            try:
                provider_detail = json.loads(error.read().decode()).get("msg", "token rejected")
            except (UnicodeDecodeError, json.JSONDecodeError):
                provider_detail = "token rejected"
            raise HTTPException(status_code=401, detail=f"Supabase rejected the token: {provider_detail}.") from error
        raise HTTPException(status_code=502, detail="Supabase token validation failed.") from error
    except URLError as error:
        raise HTTPException(status_code=502, detail="Could not reach Supabase for token validation.") from error


def get_user_rbac(auth_user: dict) -> dict:
    email = (auth_user.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Authenticated account has no email address.")

    try:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                select u.user_id, u.username, u.employee_id,
                       coalesce(array_agg(distinct r.role_name) filter (where r.role_name is not null), '{}') as roles,
                       coalesce(array_agg(distinct t.table_name) filter (where t.table_name is not null and t.can_read = true), '{}') as allowed_tables
                from public.users u
                left join public.user_roles ur on ur.user_id = u.user_id
                left join public.roles r on r.role_id = ur.role_id
                left join public.tables_allowed_per_role t on t.role_id = r.role_id and t.can_read = true
                where lower(u.username) = %s and u.is_active = true
                group by u.user_id, u.username, u.employee_id
                """,
                (email,),
            )
            row = cur.fetchone()
    except Exception as error:
        logger.exception("RBAC lookup failed for authenticated user %s", email)
        raise HTTPException(status_code=500, detail="Could not load your RBAC permissions from the database.") from error

    if not row:
        raise HTTPException(status_code=403, detail="Your account is authenticated but no active application user was found.")

    roles = [str(role).strip().lower() for role in (row["roles"] or []) if str(role).strip()]
    unknown_roles = sorted(set(roles) - FIXED_RBAC_ROLES)
    if unknown_roles:
        raise HTTPException(status_code=403, detail=f"Account has unsupported RBAC role(s): {', '.join(unknown_roles)}.")

    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "employee_id": row["employee_id"],
        "roles": roles,
        "allowed_tables": sorted(set(str(t).strip().lower() for t in (row["allowed_tables"] or []) if str(t).strip())),
    }


def _agent_error(error: Exception) -> str:
    """Return a useful client message without exposing secrets by default."""
    logger.exception("Agent request failed")
    if os.getenv("DEBUG_ERRORS", "false").lower() == "true":
        return f"Agent error: {type(error).__name__}: {error}"
    return "I couldn't process that request. Please check that the backend, Gemini API key, and Supabase database connection are configured correctly."


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/reports/{filename}")
def download_report(filename: str, _: dict = Depends(authenticated_user)):
    """Download a report generated for an authenticated user."""
    safe_filename = Path(filename).name
    if safe_filename != filename or Path(safe_filename).suffix.lower() not in {".docx", ".png"}:
        raise HTTPException(status_code=400, detail="Invalid report filename.")

    report_path = (REPORTS_DIR / safe_filename).resolve()
    if REPORTS_DIR not in report_path.parents or not report_path.is_file():
        raise HTTPException(status_code=404, detail="Report not found.")

    media_type = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if report_path.suffix.lower() == ".docx"
        else "image/png"
    )
    return FileResponse(report_path, media_type=media_type, filename=safe_filename)


@app.post("/chat")
def chat(request: ChatRequest, user: dict = Depends(authenticated_user)) -> dict[str, object]:
    rbac = get_user_rbac(user)
    try:
        result = run_query(request.query, rbac["roles"], rbac["allowed_tables"])
    except Exception as error:
        raise HTTPException(status_code=500, detail=_agent_error(error)) from error
    if isinstance(result, dict):
        return {"answer": result.get("answer", ""), "artifacts": result.get("artifacts", [])}
    return {"answer": str(result), "artifacts": []}


@app.post("/chat/stream")
def chat_stream(request: ChatRequest, user: dict = Depends(authenticated_user)):
    rbac = get_user_rbac(user)
    events: queue.Queue[dict | None] = queue.Queue()

    def emit(message: str) -> None:
        events.put({"type": "progress", "message": message})

    def worker() -> None:
        try:
            result = run_query(
                request.query,
                rbac["roles"],
                rbac["allowed_tables"],
                callback=ProgressTracer(emit),
            )
            if isinstance(result, dict):
                events.put({
                    "type": "answer",
                    "answer": result.get("answer", ""),
                    "artifacts": result.get("artifacts", []),
                })
            else:
                events.put({"type": "answer", "answer": str(result), "artifacts": []})
        except Exception as error:
            events.put({"type": "error", "message": _agent_error(error)})
        finally:
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def generate():
        while True:
            event = events.get()
            if event is None:
                break
            yield json.dumps(event) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/auth/me")
def auth_me(auth_user: dict = Depends(authenticated_user)) -> dict:
    return get_user_rbac(auth_user)


@app.post("/auth/sync-user")
def sync_user(request: RegistrationSyncRequest, auth_user: dict = Depends(authenticated_user)) -> dict[str, str | int]:
    """Create the application's employee/user/RBAC records for a new Supabase account.

    New registrations always receive the existing `sales_manager` role and the
    existing `Sales` department. No role or department rows are created here.
    """
    email = (auth_user.get("email") or "").strip().lower()
    full_name = request.full_name.strip()
    if not email:
        raise HTTPException(status_code=400, detail="The authenticated account has no email address.")
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required.")

    try:
        salary = float(DEFAULT_ANNUAL_SALARY)
    except ValueError as error:
        raise HTTPException(status_code=500, detail="DEFAULT_ANNUAL_SALARY must be a valid number.") from error

    password_hash = bcrypt.hashpw(request.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    try:
        with get_connection() as conn, conn.cursor() as cur:
            # Use the existing fixed department and role rows. Never create them during signup.
            cur.execute(
                "select department_id from public.departments where lower(department_name) = lower(%s)",
                (DEFAULT_DEPARTMENT_NAME,),
            )
            department_row = cur.fetchone()
            if not department_row:
                raise ValueError(f"Required department '{DEFAULT_DEPARTMENT_NAME}' does not exist in public.departments.")

            cur.execute(
                "select role_id from public.roles where lower(role_name) = lower(%s)",
                (DEFAULT_ROLE_NAME,),
            )
            role_row = cur.fetchone()
            if not role_row:
                raise ValueError(f"Required role '{DEFAULT_ROLE_NAME}' does not exist in public.roles.")

            # Keep employee/user/user_roles creation atomic. If any insert fails,
            # psycopg2 rolls the transaction back so partial accounts are not left behind.
            cur.execute(
                """
                insert into public.employees
                    (full_name, work_email, department_id, job_title, hire_date, annual_salary, manager_id)
                values
                    (%s, %s, %s, %s, current_date, %s, null)
                on conflict (work_email) do update set
                    full_name = excluded.full_name,
                    department_id = excluded.department_id,
                    job_title = excluded.job_title,
                    annual_salary = excluded.annual_salary
                returning employee_id
                """,
                (full_name, email, department_row["department_id"], DEFAULT_JOB_TITLE, salary),
            )
            employee_id = cur.fetchone()["employee_id"]

            cur.execute(
                """
                insert into public.users (username, password_hash, is_active, employee_id)
                values (%s, %s, true, %s)
                on conflict (username) do update set
                    password_hash = excluded.password_hash,
                    is_active = true,
                    employee_id = excluded.employee_id
                returning user_id
                """,
                (email, password_hash, employee_id),
            )
            user_id = cur.fetchone()["user_id"]

            cur.execute(
                """
                insert into public.user_roles (user_id, role_id)
                values (%s, %s)
                on conflict (user_id, role_id) do nothing
                """,
                (user_id, role_row["role_id"]),
            )

    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Application user sync failed for %s", email)
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not finish your account setup. Make sure the existing "
                "Sales department and sales_manager role are present in Supabase."
            ),
        ) from error

    return {
        "status": "created",
        "user_id": user_id,
        "employee_id": employee_id,
        "role": DEFAULT_ROLE_NAME,
        "department": DEFAULT_DEPARTMENT_NAME,
        "job_title": DEFAULT_JOB_TITLE,
    }
