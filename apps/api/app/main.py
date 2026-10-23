from fastapi import APIRouter, FastAPI

app = FastAPI(title="Lunti API", version="0.1.0")

# Feature module routers (AGENTS.md §9) are added to this router as they are built.
api_v1 = APIRouter(prefix="/api/v1")
app.include_router(api_v1)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
