INSERT INTO task_events(event_id, project_id, task_id, user_id, state, comment, updated_at, created_at)
VALUES (
    gen_random_uuid(), 
    'faa0b3e3-6971-4844-9767-5d70b1af78d8', 
    'eb079b70-42c4-49ee-b956-e8d25efaae62', 
    '117390901703903963194', 
    'LOCKED_FOR_MAPPING', 
    'task loked by dbadmin', 
    now(), 
    now()
)
RETURNING project_id, task_id, comment;