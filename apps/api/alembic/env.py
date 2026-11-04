"""Alembic environment. URL priority: `-x url=...` → sqlalchemy.url option → DATABASE_URL."""

from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context
from app.core.config import settings, to_sqlalchemy_url
from app.models import metadata

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)


def database_url() -> str:
    url = (
        context.get_x_argument(as_dictionary=True).get("url")
        or config.get_main_option("sqlalchemy.url")
        or settings.database_url
    )
    if not url:
        raise SystemExit("Set DATABASE_URL in apps/api/.env or pass -x url=postgresql://...")
    return to_sqlalchemy_url(url)


def include_object(obj, name, type_, reflected, compare_to):  # noqa: ANN001
    # auth.* belongs to Supabase Auth; alembic_version is Alembic's own table.
    if type_ == "table" and (getattr(obj, "schema", None) == "auth" or name == "alembic_version"):
        return False
    return True


def run_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    engine = create_engine(
        database_url(),
        poolclass=pool.NullPool,
        connect_args={"prepare_threshold": None},
    )
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=metadata,
            include_object=include_object,
            compare_type=True,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
