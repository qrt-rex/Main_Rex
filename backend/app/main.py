import os
import sys
import asyncio
import logging
from contextlib import asynccontextmanager

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from app.config import settings
from app.database import db_manager
from app.services.auth_service import AuthService
from app.seed import seed_database

# Routers
from app.routers.auth import router as auth_router
from app.routers.candidates import router as candidates_router
from app.routers.employees import router as employees_router
from app.routers.interns import router as interns_router
from app.routers.joining import router as joining_router
from app.routers.otp import router as otp_router
from app.routers.payroll import router as payroll_router
from app.routers.dashboard import router as dashboard_router
from app.routers.logs import router as logs_router
from app.routers.advances_loans import router as advances_loans_router
from app.routers.payroll_settings import router as payroll_settings_router
from app.routers.attendance import router as attendance_router
from app.routers.leaves import router as leaves_router
from app.routers.productivity import router as productivity_router
from app.routers.bulk_import import router as bulk_import_router
from app.routers.reports import router as reports_router
from app.routers.broadcast import router as broadcast_router
from app.routers.rbac import router as rbac_router
from app.routers.users import router as users_router
from app.routers.notifications import router as notifications_router
from app.routers.workspace import router as workspace_router
from app.routers.billing import router as billing_router
from app.routers.legal import router as legal_router
from app.routers.automations import router as automations_router
from app.routers.client_documents import router as client_documents_router
from app.routers.sales_hub import router as sales_hub_router
from app.services.automation_service import AutomationService
from app.services.rbac_service import enforce, check_route_coverage

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("rexera.main")

# Everything the API serves from disk lives inside backend/: the legacy HTML portal,
# its assets, and the logo used by generated payslips. The React CRM is built and served
# separately from ../frontend.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTAL_DIR = os.path.join(BACKEND_DIR, "legacy-portal")
BILLING_PORTAL_DIR = os.path.abspath(os.path.join(BACKEND_DIR, "..", "Bill and Invoice", "frontend"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up Rexera HR Management System...")
    await db_manager.connect()
    # Ensure default admin and seed data
    try:
        await AuthService.init_default_admin()
        await seed_database()
    except Exception as e:
        logger.warning(f"Error during initial seeding: {e}")
    # Scheduled automations (each one is off until enabled in Administration > Automations).
    scheduler = None
    if settings.AUTOMATIONS_ENABLED and settings.APP_ENV.lower() != "test":
        scheduler = asyncio.create_task(AutomationService.scheduler_loop())
    yield
    if scheduler:
        scheduler.cancel()
    logger.info("Shutting down Rexera HR Management System...")
    await db_manager.close()

IS_PRODUCTION = settings.APP_ENV.lower() == "production"

app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    description="Enterprise HR Management System with Recruitment Pipeline, Intern Tracking, Onboarding, Statutory Payroll, Productivity, Attendance & Performance Analytics",
    lifespan=lifespan,
    # The full API map is not published in production.
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# CORS: the configured origins (CORS_ORIGINS); this was hard-coded to "*" before. Auth uses bearer
# tokens, not cookies, so credentials are never needed cross-origin.
_cors_origins = [o.strip().rstrip("/") for o in settings.CORS_ORIGINS if o and o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

# Register API Routers — every route passes the central RBAC guard (rbac_service.ROUTE_RULES)
API_ROUTERS = [
    auth_router, candidates_router, employees_router, interns_router, joining_router,
    otp_router, payroll_router, advances_loans_router, payroll_settings_router,
    dashboard_router, logs_router, attendance_router, leaves_router, productivity_router,
    bulk_import_router, reports_router, broadcast_router, rbac_router, users_router,
    notifications_router, workspace_router, billing_router, legal_router, automations_router,
    client_documents_router, sales_hub_router,
]
for api_router in API_ROUTERS:
    app.include_router(api_router, dependencies=[Depends(enforce)])
check_route_coverage(API_ROUTERS)

# Health Check
@app.get("/api/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "app_name": settings.APP_NAME,
        "database_connected": db_manager.is_live_pg,
        "database_schema": settings.DB_SCHEMA,
    }

# Mount Bill & Invoice standalone portal if present
if os.path.exists(BILLING_PORTAL_DIR):
    app.mount("/billing-portal", StaticFiles(directory=BILLING_PORTAL_DIR, html=True), name="billing_portal")

# Mount static asset folders and frontend pages
if os.path.exists(PORTAL_DIR):
    assets_dir = os.path.join(PORTAL_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Serve direct logo or stamp from workspace root or assets if requested
    @app.get("/logo.png", include_in_schema=False)
    async def get_root_logo():
        root_logo = os.path.join(BACKEND_DIR, "logo.png")
        if os.path.exists(root_logo):
            return FileResponse(root_logo)
        return FileResponse(os.path.join(assets_dir, "logo.png"))

    @app.get("/stamp.png", include_in_schema=False)
    async def get_root_stamp():
        stamp_path = os.path.join(assets_dir, "stamp.png")
        if os.path.exists(stamp_path):
            return FileResponse(stamp_path)
        return JSONResponse({"error": "Stamp not found"}, status_code=404)

    # Mount entire frontend directory with HTML support as fallback
    app.mount("/", StaticFiles(directory=PORTAL_DIR, html=True), name="portal")
