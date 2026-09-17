"""add_officer_email_to_human_decisions

Revision ID: a06738c40066
Revises: 9f5627b30055
Create Date: 2026-09-18 00:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a06738c40066'
down_revision: Union[str, None] = '9f5627b30055'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('human_decisions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('officer_email', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('human_decisions', schema=None) as batch_op:
        batch_op.drop_column('officer_email')
