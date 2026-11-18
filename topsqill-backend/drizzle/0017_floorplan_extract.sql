-- The real 2D/3D/hologram layout is built only from a floor plan the owner
-- uploaded, read by AI into room shapes and sizes. Null until that happens.
alter table listings add column if not exists floorplan_data jsonb;
