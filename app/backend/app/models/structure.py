from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

StructureSystem = Literal["concrete_moment_frame", "steel_moment_frame", "wood_light_frame", "masonry"]


class StructureSpec(BaseModel):
    stories: int = Field(ge=1, le=80)
    story_height_m: float = Field(gt=0.0, le=10.0)
    plan_x_m: float = Field(gt=0.0, le=200.0)
    plan_y_m: float = Field(gt=0.0, le=200.0)
    mass_per_floor_t: float = Field(gt=0.0, le=10000.0)
    period_guess_s: float | None = Field(default=None, ge=0.05, le=10.0)
    system: StructureSystem = "concrete_moment_frame"
