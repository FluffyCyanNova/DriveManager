"""upload jobs can target a virtual folder

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-06 12:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('upload_jobs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('virtual_folder_id', sa.String(length=36), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('upload_jobs', schema=None) as batch_op:
        batch_op.drop_column('virtual_folder_id')
