"""The running API must know every table. Tests that run migrations import app.models as a
side effect, which once hid a 500 on POST /transactions (its receipts foreign key couldn't be
resolved). Check in a fresh interpreter, the way uvicorn starts the app."""

import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]

SCRIPT = """
import app.main
from sqlalchemy.orm import configure_mappers
from app.core.db import Base
configure_mappers()
for table in Base.metadata.sorted_tables:
    for fk in table.foreign_keys:
        fk.column  # raises NoReferencedTableError if the target table isn't registered
print(",".join(sorted(Base.metadata.tables)))
"""


def test_app_registers_every_table_and_foreign_key() -> None:
    result = subprocess.run(
        [sys.executable, "-c", SCRIPT], cwd=API_DIR, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr[-2000:]
    tables = set(result.stdout.strip().split(","))
    assert {"transactions", "receipts", "budgets", "products", "categories"} <= tables
